/**
 * `GET /api/stats` — the long view: daily buckets, period summaries, incidents.
 *
 * Separate from `/api/monitors` on purpose. That endpoint is polled every minute
 * by the office and the dashboard and must stay small; this one is read when
 * somebody actually wants last month's numbers.
 *
 * Query parameters:
 *   target   restrict to one roster id (default: all)
 *   days     how many daily buckets to return (0–400, default 30)
 *
 * Public and read-only, like `/api/monitors`.
 */
import { resolveRoster } from '../dist/store/roster.js';
import { readAllStats } from '../dist/store/stats-store.js';
import { summarize } from '../dist/store/rollup.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { parseIntParam } from '../dist/util/params.js';
import { ROSTER } from '../dist/roster.data.js';

const MAX_DAYS = 400;
const DEFAULT_DAYS = 30;

/** The windows worth naming. Weekly and monthly are what people actually ask for. */
const PERIODS = [
  ['day', 1],
  ['week', 7],
  ['month', 30],
  ['quarter', 90],
];

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  let targets;
  let offsetMinutes = 0;
  try {
    targets = resolveRoster(ROSTER);
    offsetMinutes = Number(ROSTER?.stats?.timezoneOffsetMinutes) || 0;
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

  const days = parseIntParam(query.get('days'), { min: 0, max: MAX_DAYS, fallback: DEFAULT_DAYS });

  const kv = kvFromEnv();
  if (!kv) {
    res.status(200).json({
      storage: 'none',
      hint: `Set one of these credential pairs to keep statistics: ${kvEnvNames().join(', ')}`,
      generatedAt: new Date().toISOString(),
      timezoneOffsetMinutes: offsetMinutes,
      targets: targets.map((target) => ({
        id: target.id,
        name: target.name,
        url: target.url,
        periods: {},
        daily: [],
        incidents: [],
      })),
    });
    return;
  }

  try {
    const all = await readAllStats(kv, targets.map((target) => target.id), offsetMinutes);
    const byId = new Map(all.map((stats) => [stats.id, stats]));

    res.status(200).json({
      storage: 'kv',
      generatedAt: new Date().toISOString(),
      timezoneOffsetMinutes: offsetMinutes,
      targets: targets.map((target) => {
        const stats = byId.get(target.id);
        return {
          id: target.id,
          name: target.name,
          url: target.url,
          periods: Object.fromEntries(
            PERIODS.map(([label, windowDays]) => [label, summarize(stats, windowDays)]),
          ),
          daily: days > 0 ? stats.daily.slice(-days) : [],
          // Newest first: an incident list is read from the top.
          incidents: [...stats.incidents].reverse(),
        };
      }),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read statistics: ${err.message}` });
  }
}
