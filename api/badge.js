/**
 * `GET /api/badge` — a status badge someone can paste into a README.
 *
 * The whole point is that it renders somewhere else, so the response is one
 * self-contained SVG: no script, no webfont, no second request.
 *
 * Query parameters:
 *   target   roster id (required)
 *   metric   `uptime` (default) or `state`
 *   days     window for the uptime figure (1–400, default 30)
 *   label    override the left-hand text
 *
 * Unlike the JSON endpoints this one is cached for five minutes. A badge is
 * embedded in pages that get hammered, and GitHub proxies images anyway, so
 * insisting on a fresh read per view would buy nothing.
 *
 * A badge always renders. An unknown target, a missing store or a broken read all
 * produce a grey badge that says so, because a broken image in somebody's README
 * is worse than an honest "no data".
 */
import { resolveRoster } from '../dist/store/roster.js';
import { readStats } from '../dist/store/stats-store.js';
import { readEntry } from '../dist/store/uptime.js';
import { summarize } from '../dist/store/rollup.js';
import { badgeSvg, toneForState, toneForUptime } from '../dist/badge/svg.js';
import { kvFromEnv } from '../dist/store/kv.js';
import { parseIntParam } from '../dist/util/params.js';
import { ROSTER } from '../dist/roster.data.js';

const DEFAULT_DAYS = 30;

function send(res, label, value, tone, { cache = true } = {}) {
  res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
  res.setHeader('cache-control', cache ? 'public, max-age=300' : 'no-store');
  // The SVG is generated here and embeds no caller input beyond the label, which
  // is escaped — but a badge is served cross-site, so say what it is and nothing more.
  res.setHeader('x-content-type-options', 'nosniff');
  res.status(200).send(badgeSvg({ label, value, tone }));
}

export default async function handler(req, res) {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  // The label is drawn into the SVG, so it is capped and stripped of anything
  // that is not plain text before it gets near the markup.
  const custom = (query.get('label') ?? '').replace(/[^\w \-.%가-힣]/g, '').slice(0, 24);
  const metric = query.get('metric') === 'state' ? 'state' : 'uptime';
  const wanted = query.get('target');

  let target = null;
  try {
    target = resolveRoster(ROSTER).find((entry) => entry.id === wanted) ?? null;
  } catch {
    return send(res, custom || 'statusdog', 'config error', 'unknown', { cache: false });
  }

  if (!target) {
    return send(res, custom || 'statusdog', 'unknown target', 'unknown', { cache: false });
  }

  const label = custom || (metric === 'state' ? 'status' : 'uptime');
  const kv = kvFromEnv();
  if (!kv) return send(res, label, 'no data', 'unknown', { cache: false });

  try {
    if (metric === 'state') {
      const entry = await readEntry(kv, target);
      const text = entry.state === 'up' ? 'up' : entry.state === 'down' ? 'down' : 'unknown';
      return send(res, label, text, toneForState(entry.state));
    }

    const days = parseIntParam(query.get('days'), { min: 1, max: 400, fallback: DEFAULT_DAYS });
    const offsetMinutes = Number(ROSTER?.stats?.timezoneOffsetMinutes) || 0;
    const summary = summarize(await readStats(kv, target.id, offsetMinutes), days);

    // No checks is not zero percent, here as everywhere else.
    if (summary.checks === 0 || summary.uptimePct === null) {
      return send(res, label, 'no data', 'unknown');
    }
    // Trailing zeroes read as false precision on a badge: 99.9%, not 99.90%.
    const pct = Number(summary.uptimePct.toFixed(2));
    return send(res, label, `${pct}%`, toneForUptime(pct));
  } catch {
    return send(res, label, 'unavailable', 'unknown', { cache: false });
  }
}
