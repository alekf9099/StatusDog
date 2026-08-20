/**
 * `GET /api/incidents` — the detailed report for each outage.
 *
 * Separate from `/api/stats` for the same reason that one is separate from
 * `/api/monitors`: this payload carries snapshots and an excerpt of a failing page,
 * and nothing that polls on a timer should be pulling it.
 *
 * Query parameters:
 *   target   restrict to one roster id (default: all)
 *   limit    how many reports per target (1–30, default 10)
 *
 * Public and read-only. Everything here was already served publicly by the
 * monitored site itself: a status code, curated response headers, the address that
 * answered, and a short piece of a page any visitor would have seen. Nothing about
 * the monitor's own configuration or credentials goes out.
 */
import { resolveRoster } from '../dist/store/roster.js';
import { readLog } from '../dist/store/incident-store.js';
import { REPORT_LIMIT } from '../dist/store/incident.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { parseIntParam } from '../dist/util/params.js';
import { ROSTER } from '../dist/roster.data.js';

const DEFAULT_LIMIT = 10;

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
  const wanted = query.get('target');
  if (wanted) {
    targets = targets.filter((target) => target.id === wanted);
    if (targets.length === 0) {
      res.status(404).json({ error: `Unknown target "${wanted}".` });
      return;
    }
  }

  const limit = parseIntParam(query.get('limit'), {
    min: 1,
    max: REPORT_LIMIT,
    fallback: DEFAULT_LIMIT,
  });

  const kv = kvFromEnv();
  if (!kv) {
    res.status(200).json({
      storage: 'none',
      hint: `Set one of these credential pairs to keep incident reports: ${kvEnvNames().join(', ')}`,
      generatedAt: new Date().toISOString(),
      targets: targets.map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        reports: [],
      })),
    });
    return;
  }

  try {
    const logs = await Promise.all(targets.map((target) => readLog(kv, target.id)));
    const byId = new Map(logs.map((log) => [log.targetId, log]));

    res.status(200).json({
      storage: 'kv',
      generatedAt: new Date().toISOString(),
      targets: targets.map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        // Newest first: a report list is read from the top.
        reports: [...(byId.get(target.id)?.reports ?? [])].reverse().slice(0, limit),
      })),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read incident reports: ${err.message}` });
  }
}
