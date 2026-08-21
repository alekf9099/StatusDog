/**
 * `GET /api/feed?target=<id>` — outage history as RSS.
 *
 * The only way to subscribe to a StatusDog site today. Email needs an address and
 * therefore an account, and there are no accounts; a feed needs nothing but a URL.
 *
 * Query parameters:
 *   target   roster id (required)
 *   lang     `en` or `ko`, for the feed's declared language
 *
 * Cached for five minutes: readers poll on their own schedule and a run only
 * happens every half hour or so, so a fresh read per poll would buy nothing.
 */
import { resolveRoster } from '../dist/store/roster.js';
import { readStats } from '../dist/store/stats-store.js';
import { readLog } from '../dist/store/incident-store.js';
import { feedXml } from '../dist/feed/rss.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { originOf } from '../dist/util/origin.js';
import { ROSTER } from '../dist/roster.data.js';

export default async function handler(req, res) {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const wanted = query.get('target');
  const language = query.get('lang') === 'ko' ? 'ko' : 'en';

  let target;
  try {
    target = resolveRoster(ROSTER).find((entry) => entry.id === wanted) ?? null;
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  if (!target) {
    res.setHeader('cache-control', 'no-store');
    res.status(404).json({
      error: wanted ? `Unknown target "${wanted}".` : 'A target is required.',
      hint: 'GET /api/feed?target=<roster id>',
    });
    return;
  }

  const kv = kvFromEnv();
  const generatedAt = new Date().toISOString();
  const base = {
    target: { id: target.id, name: target.name, url: target.url },
    origin: originOf(req, process.env),
    generatedAt,
    language,
  };

  if (!kv) {
    // An empty feed rather than an error: a reader that gets a 503 may stop asking.
    res.setHeader('content-type', 'application/rss+xml; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-statusdog-storage', `none (${kvEnvNames().join(', ')})`);
    res.status(200).send(feedXml({ ...base, incidents: [] }));
    return;
  }

  try {
    const offsetMinutes = Number(ROSTER?.stats?.timezoneOffsetMinutes) || 0;
    const [stats, log] = await Promise.all([
      readStats(kv, target.id, offsetMinutes),
      readLog(kv, target.id),
    ]);

    res.setHeader('content-type', 'application/rss+xml; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.status(200).send(feedXml({
      ...base,
      incidents: stats.incidents ?? [],
      reports: log.reports ?? [],
    }));
  } catch (err) {
    res.setHeader('cache-control', 'no-store');
    res.status(502).json({ error: `Could not read the outage history: ${err.message}` });
  }
}
