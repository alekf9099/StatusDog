/**
 * `GET /api/monitors` — the 24/7 roster and its stored history.
 *
 * Read-only and public. The roster itself is a committed file, so there is
 * nothing here for a caller to change — see src/store/roster.ts for why.
 *
 * When no key-value store is configured the roster is still returned, with
 * `storage: "none"`, so the dashboard can say so instead of looking broken.
 */
import { resolveRoster } from '../dist/store/roster.js';
import { readAll, statsFor } from '../dist/store/uptime.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { ROSTER } from '../dist/roster.data.js';

const MAX_HISTORY = 480;

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  let targets;
  try {
    targets = resolveRoster(ROSTER);
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  const requested = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('history'));
  const historyLimit = Number.isFinite(requested)
    ? Math.min(MAX_HISTORY, Math.max(0, Math.trunc(requested)))
    : 60;

  const kv = kvFromEnv();
  if (!kv) {
    res.status(200).json({
      storage: 'none',
      hint: `Set one of these credential pairs to persist history: ${kvEnvNames().join(', ')}`,
      generatedAt: new Date().toISOString(),
      monitors: targets.map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        state: 'unknown',
        since: null,
        lastResult: null,
        stats: null,
        history: [],
      })),
    });
    return;
  }

  try {
    const entries = await readAll(kv, targets);
    res.status(200).json({
      storage: 'kv',
      generatedAt: new Date().toISOString(),
      monitors: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        url: entry.url,
        state: entry.state,
        since: entry.since,
        lastResult: entry.lastResult,
        stats: statsFor(entry),
        history: historyLimit > 0 ? entry.history.slice(-historyLimit) : [],
      })),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read the store: ${err.message}` });
  }
}
