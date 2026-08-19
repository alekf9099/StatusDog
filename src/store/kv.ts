/**
 * Minimal key-value client for Redis-compatible REST APIs (Vercel KV, Upstash).
 *
 * Deliberately built on `fetch` and nothing else: StatusDog ships with zero
 * runtime dependencies, and a monitoring tool that needs a 40-package client
 * library to record "the site was up" has its priorities backwards.
 */

export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /** Where this client is pointed, for diagnostics. Never includes the token. */
  readonly origin: string;
}

export class KvError extends Error {
  override name = 'KvError';
}

export interface KvOptions {
  url: string;
  token: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Env var pairs to look for, in order. Vercel KV, the Upstash marketplace
 * integration and a manual setup all name them differently.
 */
const ENV_PAIRS: Array<[urlKey: string, tokenKey: string]> = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['REDIS_REST_URL', 'REDIS_REST_TOKEN'],
];

export function createKvClient(options: KvOptions): KvClient {
  const url = options.url.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 8_000;
  const doFetch = options.fetchImpl ?? fetch;
  const origin = safeOrigin(url);

  async function command(args: Array<string | number>): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new KvError(`${origin} unreachable: ${(err as Error).message}`);
    }

    if (!response.ok) {
      // The body may carry a useful message; it may also be an HTML error page.
      const text = await response.text().catch(() => '');
      throw new KvError(
        `${origin} returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }

    const payload = (await response.json()) as { result?: unknown; error?: string };
    if (payload.error) throw new KvError(`${origin}: ${payload.error}`);
    return payload.result ?? null;
  }

  return {
    origin,
    async get(key) {
      const result = await command(['GET', key]);
      return result === null || result === undefined ? null : String(result);
    },
    async set(key, value) {
      await command(['SET', key, value]);
    },
    async del(key) {
      await command(['DEL', key]);
    },
  };
}

/**
 * Build a client from the environment, or `null` when no store is configured.
 *
 * Returning `null` rather than throwing is the point: the site has to work
 * before anyone has provisioned a database, just with less to show.
 */
export function kvFromEnv(env: NodeJS.ProcessEnv = process.env): KvClient | null {
  for (const [urlKey, tokenKey] of ENV_PAIRS) {
    const url = env[urlKey];
    const token = env[tokenKey];
    if (url && token) return createKvClient({ url, token });
  }
  return null;
}

/** Names of the env vars a deployment can use, for error messages and docs. */
export function kvEnvNames(): string[] {
  return ENV_PAIRS.flat();
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'kv';
  }
}
