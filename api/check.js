/**
 * `GET /api/check?url=…` — probe a URL once and return the diagnostic report.
 *
 * Stateless: nothing is stored, so this works on any Vercel plan. Persistent
 * uptime history is a separate, database-backed concern.
 *
 * Query parameters:
 *   url        required, http(s) only; a bare host gets https:// prepended
 *   expect     accepted statuses, e.g. `200` or `2xx,3xx`  (default: 2xx,3xx)
 *   contains   response body must contain this text
 *   forbid     comma-separated text that must NOT appear
 *   method     HTTP method                                  (default: GET)
 *   timeout    milliseconds, 1000–30000                     (default: 15000)
 *   redirects  `false` to stop following redirects
 */
import { probeUrl } from '../dist/monitor/probe.js';
import { normalizeCheckUrl, UnsafeUrlError } from '../dist/monitor/target-url.js';
import { parseIntParam } from '../dist/util/params.js';

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;

  let url;
  try {
    url = normalizeCheckUrl(query.get('url'));
  } catch (err) {
    const message = err instanceof UnsafeUrlError ? err.message : 'Invalid URL.';
    res.status(400).json({ error: message });
    return;
  }

  const method = (query.get('method') ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    res.status(400).json({ error: `Unsupported method "${method}".` });
    return;
  }

  const expect = query.get('expect');
  const contains = query.get('contains');
  const forbid = query.get('forbid');

  try {
    const result = await probeUrl(url, {
      method,
      timeoutMs: parseIntParam(query.get('timeout'), {
        min: MIN_TIMEOUT_MS,
        max: MAX_TIMEOUT_MS,
        fallback: DEFAULT_TIMEOUT_MS,
      }),
      expectStatus: expect
        ? expect.split(',').map((value) => value.trim()).filter(Boolean)
        : ['2xx', '3xx'],
      expectBody: contains || null,
      forbidBody: forbid ? forbid.split(',').map((value) => value.trim()).filter(Boolean) : [],
      followRedirects: query.get('redirects') !== 'false',
    });
    res.status(200).json(result);
  } catch (err) {
    // probeUrl reports failures in its result, so reaching here is a real bug.
    res.status(500).json({ error: err?.message ?? 'Check failed.' });
  }
}
