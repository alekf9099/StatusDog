import http from 'node:http';
import https from 'node:https';
import { USER_AGENT } from '../config/defaults.js';
import type { FailureReason, ProbeResult, ResolvedTarget } from '../config/types.js';
import { bodyMatches, describeExpectations, statusMatches } from './matchers.js';

/** Response bodies are only read up to this size; the rest is drained. */
const MAX_BODY_BYTES = 64 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class ProbeError extends Error {
  constructor(readonly reason: FailureReason, message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Run a single health check against `target`.
 *
 * Never throws: transport failures are reported as a failed {@link ProbeResult}
 * so a flaky target can never take the scheduler down.
 */
export async function probe(target: ResolvedTarget): Promise<ProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  let currentUrl = target.url;
  let method = target.method;
  let redirects = 0;

  try {
    for (;;) {
      const remaining = target.timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        throw new ProbeError('timeout', `Timed out after ${target.timeoutMs}ms`);
      }

      const response = await requestOnce(currentUrl, target, method, remaining);
      const location = response.headers.location;

      if (
        target.followRedirects &&
        REDIRECT_STATUSES.has(response.status) &&
        typeof location === 'string'
      ) {
        if (redirects >= target.maxRedirects) {
          throw new ProbeError(
            'network',
            `Exceeded ${target.maxRedirects} redirects (last hop: ${currentUrl})`,
          );
        }
        redirects++;
        currentUrl = new URL(location, currentUrl).toString();
        // Match browser behaviour: 303 always downgrades to GET, and so do
        // 301/302 for non-idempotent methods.
        if (response.status === 303 || (response.status < 307 && method !== 'GET' && method !== 'HEAD')) {
          method = 'GET';
        }
        continue;
      }

      const responseTimeMs = Date.now() - startedAt;
      const failure = evaluate(target, response, responseTimeMs);
      return {
        url: target.url,
        finalUrl: currentUrl,
        ok: failure === null,
        status: response.status,
        responseTimeMs,
        redirects,
        checkedAt,
        reason: failure?.reason ?? null,
        message: failure?.message ?? null,
      };
    }
  } catch (err) {
    const probeError = toProbeError(err);
    return {
      url: target.url,
      finalUrl: currentUrl,
      ok: false,
      status: null,
      responseTimeMs: Date.now() - startedAt,
      redirects,
      checkedAt,
      reason: probeError.reason,
      message: probeError.message,
    };
  }
}

function evaluate(
  target: ResolvedTarget,
  response: RawResponse,
  responseTimeMs: number,
): { reason: FailureReason; message: string } | null {
  if (!statusMatches(response.status, target.expectStatus)) {
    return {
      reason: 'status',
      message: `Unexpected status ${response.status} (expected ${describeExpectations(target.expectStatus)})`,
    };
  }
  if (target.expectBody !== null && !bodyMatches(response.body, target.expectBody, target.expectBodyIsRegex)) {
    const kind = target.expectBodyIsRegex ? 'match' : 'contain';
    return {
      reason: 'body',
      message: `Response body did not ${kind} ${JSON.stringify(target.expectBody)}`,
    };
  }
  if (target.maxResponseTimeMs > 0 && responseTimeMs > target.maxResponseTimeMs) {
    return {
      reason: 'slow',
      message: `Responded in ${responseTimeMs}ms (limit ${target.maxResponseTimeMs}ms)`,
    };
  }
  return null;
}

function requestOnce(
  urlString: string,
  target: ResolvedTarget,
  method: string,
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      reject(new ProbeError('invalid-url', `Invalid URL: ${urlString}`));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new ProbeError('invalid-url', `Unsupported protocol: ${url.protocol}`));
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    let timedOut = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const request = transport.request(
      url,
      {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...target.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          if (received < MAX_BODY_BYTES) chunks.push(chunk);
          received += chunk.length;
        });
        response.on('end', () => {
          finish(() =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8'),
            }),
          );
        });
        response.on('error', (err) => finish(() => reject(toProbeError(err, timedOut))));
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.on('error', (err) => finish(() => reject(toProbeError(err, timedOut))));

    if (target.body !== null && method !== 'GET' && method !== 'HEAD') {
      request.write(target.body);
    }
    request.end();
  });
}

function toProbeError(err: unknown, timedOut = false): ProbeError {
  if (err instanceof ProbeError) return err;
  if (timedOut) {
    return new ProbeError('timeout', (err as Error)?.message ?? 'Request timed out');
  }
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = (err as Error)?.message ?? String(err);
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new ProbeError('dns', `DNS lookup failed (${code})`);
    case 'ECONNREFUSED':
      return new ProbeError('refused', 'Connection refused');
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return new ProbeError('timeout', 'Connection timed out');
    default:
      return new ProbeError('network', code ? `${code}: ${message}` : message);
  }
}

/** Convenience wrapper for one-off checks (used by `statusdog check <url>`). */
export function probeUrl(
  url: string,
  overrides: Partial<ResolvedTarget> = {},
): Promise<ProbeResult> {
  const target: ResolvedTarget = {
    id: 'adhoc',
    name: url,
    url,
    method: 'GET',
    headers: {},
    body: null,
    intervalMs: 60_000,
    timeoutMs: 10_000,
    expectStatus: ['2xx', '3xx'],
    expectBody: null,
    expectBodyIsRegex: false,
    maxResponseTimeMs: 0,
    followRedirects: true,
    maxRedirects: 5,
    failureThreshold: 1,
    recoveryThreshold: 1,
    fallback: {
      template: 'maintenance',
      title: 'We will be right back',
      message: 'This service is temporarily unavailable.',
      statusCode: 503,
      retryAfterSeconds: 120,
      vars: {},
    },
    enabled: true,
    ...overrides,
  };
  return probe(target);
}
