/**
 * `POST /api/cron/check` — probe every roster target and persist the results.
 *
 * This is the 24/7 half of StatusDog: something has to call it on a schedule.
 * Two ways, both configured in the repo:
 *
 *   - GitHub Actions (.github/workflows/monitor.yml) — every 15 minutes, free,
 *     and the default here because Vercel's Hobby plan caps cron at once a day.
 *   - Vercel Cron — add a `crons` entry to vercel.json on a Pro plan. Vercel
 *     sends `Authorization: Bearer $CRON_SECRET`, which this accepts as-is.
 *
 * Requires two environment variables:
 *   CRON_SECRET                     shared secret; without it the route is closed
 *   KV_REST_API_URL / _TOKEN        (or the Upstash equivalents) for storage
 */
import { probe } from '../../dist/monitor/probe.js';
import { resolveRoster } from '../../dist/store/roster.js';
import { applyCheck } from '../../dist/store/uptime.js';
import { kvEnvNames, kvFromEnv } from '../../dist/store/kv.js';
import { ROSTER } from '../../dist/roster.data.js';

/** Constant-time-ish comparison so the secret cannot be probed byte by byte. */
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function presentedSecret(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const header = req.headers?.['x-cron-secret'];
  return typeof header === 'string' ? header : null;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({
      error: 'CRON_SECRET is not set, so scheduled checks are disabled.',
      hint: 'Set CRON_SECRET in the deployment environment and in the scheduler.',
    });
    return;
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({
      error: 'No key-value store is configured, so results cannot be persisted.',
      hint: `Set one of these credential pairs: ${kvEnvNames().join(', ')}`,
    });
    return;
  }

  let targets;
  try {
    targets = resolveRoster(ROSTER);
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  const startedAt = Date.now();
  const checks = await Promise.all(targets.map(async (target) => {
    const result = await probe(target);
    try {
      const { entry, transitioned } = await applyCheck(kv, target, result);
      return {
        id: target.id,
        ok: result.ok,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        state: entry.state,
        transitioned,
        stored: true,
      };
    } catch (err) {
      // A storage failure must not hide the check itself.
      return {
        id: target.id,
        ok: result.ok,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
        stored: false,
        storeError: err.message,
      };
    }
  }));

  const failedToStore = checks.filter((check) => !check.stored);
  res.status(failedToStore.length === checks.length && checks.length > 0 ? 502 : 200).json({
    checkedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    targets: checks.length,
    down: checks.filter((check) => !check.ok).length,
    transitions: checks.filter((check) => check.transitioned).map((check) => check.id),
    checks,
  });
}
