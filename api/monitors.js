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
import {
  DEFAULT_STALE_AFTER_MS,
  evaluateStaleness,
  readSchedulerState,
} from '../dist/store/scheduler.js';
import { parseIntParam } from '../dist/util/params.js';
import { ROSTER } from '../dist/roster.data.js';

const MAX_HISTORY = 480;
const DEFAULT_HISTORY = 60;

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  let targets;
  try {
    targets = resolveRoster(ROSTER);
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const historyLimit = parseIntParam(query.get('history'), {
    min: 0,
    max: MAX_HISTORY,
    fallback: DEFAULT_HISTORY,
  });

  const kv = kvFromEnv();
  if (!kv) {
    res.status(200).json({
      storage: 'none',
      hint: `Set one of these credential pairs to persist history: ${kvEnvNames().join(', ')}`,
      generatedAt: new Date().toISOString(),
      scheduler: null,
      monitors: targets.map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        state: 'unknown',
        since: null,
        consecutiveFailures: 0,
        maxResponseTimeMs: target.maxResponseTimeMs,
        lastResult: null,
        stats: null,
        history: [],
      })),
    });
    return;
  }

  try {
    const [entries, schedulerState] = await Promise.all([
      readAll(kv, targets),
      readSchedulerState(kv),
    ]);
    const limits = new Map(targets.map((target) => [target.id, target.maxResponseTimeMs]));
    const staleAfterMs = parseIntParam(process.env.STATUSDOG_STALE_AFTER_MINUTES, {
      min: 5,
      max: 24 * 60,
      fallback: DEFAULT_STALE_AFTER_MS / 60_000,
    }) * 60_000;

    res.status(200).json({
      storage: 'kv',
      generatedAt: new Date().toISOString(),
      // So a reader is never shown last Tuesday's numbers as if they were current.
      scheduler: evaluateStaleness(schedulerState, Date.now(), staleAfterMs),
      monitors: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        url: entry.url,
        state: entry.state,
        since: entry.since,
        // Failures that have happened but not yet crossed failureThreshold.
        consecutiveFailures: entry.consecutiveFailures,
        // Roster config, not a secret: lets a client say "close to your limit".
        maxResponseTimeMs: limits.get(entry.id) ?? 0,
        lastResult: entry.lastResult,
        stats: statsFor(entry),
        history: historyLimit > 0 ? entry.history.slice(-historyLimit) : [],
      })),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read the store: ${err.message}` });
  }
}
