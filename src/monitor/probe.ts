import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { USER_AGENT } from '../config/defaults.js';
import type {
  FailureReason,
  ProbeDetail,
  ProbeResult,
  RedirectHop,
  ResolvedTarget,
  TlsInfo,
} from '../config/types.js';
import { bodyMatches, describeExpectations, statusMatches } from './matchers.js';

/** Response bodies are only read up to this size; the rest is drained. */
const MAX_BODY_BYTES = 64 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Response headers worth reporting. An allowlist rather than a denylist, so a
 * `set-cookie` or an auth echo can never leak into a shareable report.
 */
const REPORTED_HEADERS = [
  'server',
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'age',
  'date',
  'location',
  'x-powered-by',
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'access-control-allow-origin',
  'retry-after',
  'x-cache',
  'cf-cache-status',
  'x-vercel-cache',
];

/**
 * Dedicated agents so probes never share sockets with anything else.
 *
 * `maxCachedSessions: 0` matters: with TLS session resumption the server skips
 * re-sending its certificate chain, so `getPeerCertificate()` comes back empty
 * on every check after the first. Forcing a full handshake also makes the
 * measured response time comparable from one check to the next.
 */
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });

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
  tls: TlsInfo | null;
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
  const chain: RedirectHop[] = [];
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
        chain.push({ url: currentUrl, status: response.status, location });
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
        detail: buildDetail(response, chain),
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
      detail: chain.length > 0 ? { headers: {}, tls: null, chain } : null,
    };
  }
}

function buildDetail(response: RawResponse, chain: RedirectHop[]): ProbeDetail {
  const headers: Record<string, string> = {};
  for (const name of REPORTED_HEADERS) {
    const value = response.headers[name];
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return { headers, tls: response.tls, chain };
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

    const secure = url.protocol === 'https:';
    const transport = secure ? https : http;
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
        agent: secure ? httpsAgent : httpAgent,
        headers: {
          'user-agent': USER_AGENT,
          accept: '*/*',
          ...target.headers,
        },
      },
      (response) => {
        // Read the certificate now: the socket may be pooled or torn down later.
        const tls = readTlsInfo(response.socket);
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
              tls,
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

function readTlsInfo(socket: unknown): TlsInfo | null {
  const tlsSocket = socket as TLSSocket | undefined;
  if (!tlsSocket || typeof tlsSocket.getPeerCertificate !== 'function') return null;

  try {
    const cert = tlsSocket.getPeerCertificate();
    if (!cert || Object.keys(cert).length === 0) return null;

    const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
    const expiry = validTo && !Number.isNaN(validTo.getTime()) ? validTo : null;
    return {
      subject: firstValue(cert.subject?.CN),
      issuer: firstValue(cert.issuer?.O) ?? firstValue(cert.issuer?.CN),
      validFrom: cert.valid_from ?? null,
      validTo: cert.valid_to ?? null,
      daysRemaining: expiry
        ? Math.floor((expiry.getTime() - Date.now()) / 86_400_000)
        : null,
      protocol: tlsSocket.getProtocol?.() ?? null,
    };
  } catch {
    // Certificate details are a nice-to-have; never fail a check over them.
    return null;
  }
}

/** Certificate fields are `string | string[]` depending on the certificate. */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Certificate and handshake failures, in words someone can act on.
 *
 * `rejectUnauthorized` is left at its default, so an invalid certificate fails
 * the check rather than being quietly accepted — which is the right call for a
 * monitor: visitors would see the same failure.
 */
const TLS_ERRORS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'TLS certificate has expired',
  CERT_NOT_YET_VALID: 'TLS certificate is not valid yet',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate does not cover this hostname',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate chain is incomplete or untrusted',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS certificate chain contains a self-signed certificate',
  CERT_UNTRUSTED: 'TLS certificate is not trusted',
  CERT_REVOKED: 'TLS certificate has been revoked',
  ERR_SSL_WRONG_VERSION_NUMBER: 'Not a TLS port — is this https on an http listener?',
  EPROTO: 'TLS handshake failed',
};

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
    default: {
      // Node rejects a bad certificate before any response arrives, so these used
      // to surface as an opaque "network: CERT_HAS_EXPIRED". Naming them turns a
      // puzzling alert into an actionable one.
      const tls = TLS_ERRORS[code ?? ''];
      if (tls) return new ProbeError('tls', tls);
      return new ProbeError('network', code ? `${code}: ${message}` : message);
    }
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
    // A one-off check has nowhere to remember a warning, so it makes none.
    certExpiryWarnDays: [],
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
