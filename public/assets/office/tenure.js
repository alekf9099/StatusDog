/**
 * How long a dog has been on the job, and how long since it last had a bad day.
 *
 * Uptime percentages are the honest way to report reliability and a poor way to make
 * anyone care. "99.94%" is a number; "무사고 61일 — 최장 기록" is a streak, and a
 * streak is something you notice breaking. Same data, read differently.
 *
 * Everything here comes from figures the pages already fetch: `since` from
 * `/api/monitors`, and the incident list plus daily buckets from `/api/stats`. No new
 * storage, and nothing is invented — a dog with no history says so rather than
 * claiming a clean record it has not earned.
 */

const DAY_MS = 86_400_000;

/** Whole days between two instants, or `null` if either is unusable. */
export function daysBetween(fromIso, toMs = Date.now()) {
  const from = Date.parse(fromIso ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(toMs)) return null;
  return Math.max(0, Math.floor((toMs - from) / DAY_MS));
}

/**
 * The current clean run: time in the present state, when that state is healthy.
 *
 * `since` is when the target last changed state, so for a target that is up it is
 * exactly "nothing has gone wrong since". For one that is down the streak is over
 * and the honest answer is `null` rather than zero.
 */
export function currentStreak(monitor, nowMs = Date.now()) {
  if (!monitor || monitor.state !== 'up') return null;
  return daysBetween(monitor.since, nowMs);
}

/**
 * The longest gap between outages this target has on record.
 *
 * Bounded by when records begin: a site with one outage last week and data going
 * back a year has a best run of about a year, and one with no data at all has no
 * record to report. Returns `null` when there is not enough history to say.
 */
export function longestStreak(stats, nowMs = Date.now()) {
  const incidents = [...(stats?.incidents ?? [])]
    .map((incident) => ({
      start: Date.parse(incident.startedAt ?? ''),
      end: incident.endedAt ? Date.parse(incident.endedAt) : nowMs,
    }))
    .filter((incident) => Number.isFinite(incident.start))
    .sort((a, b) => a.start - b.start);

  const firstDay = (stats?.daily ?? [])[0]?.day;
  const recordsBegin = firstDay ? Date.parse(`${firstDay}T00:00:00Z`) : null;
  if (!Number.isFinite(recordsBegin)) return null;

  // The gaps are: start of records → first outage, between outages, last → now.
  let best = 0;
  let cursor = recordsBegin;
  for (const incident of incidents) {
    if (incident.start > cursor) best = Math.max(best, incident.start - cursor);
    cursor = Math.max(cursor, Number.isFinite(incident.end) ? incident.end : cursor);
  }
  best = Math.max(best, nowMs - cursor);

  return Math.max(0, Math.floor(best / DAY_MS));
}

/** How long there has been any record of this target at all. */
export function tenureDays(stats, nowMs = Date.now()) {
  const firstDay = (stats?.daily ?? [])[0]?.day;
  if (!firstDay) return null;
  const begin = Date.parse(`${firstDay}T00:00:00Z`);
  if (!Number.isFinite(begin)) return null;
  return Math.max(0, Math.floor((nowMs - begin) / DAY_MS));
}

/**
 * Everything a desk plate needs.
 *
 * `record` is true when the current run is also the best one — the moment worth
 * showing, because it is the only time a streak is news rather than a statistic.
 */
export function tenureOf(monitor, stats, nowMs = Date.now()) {
  const streak = currentStreak(monitor, nowMs);
  const longest = longestStreak(stats, nowMs);
  return {
    tenure: tenureDays(stats, nowMs),
    streak,
    longest,
    record: streak !== null && longest !== null && streak >= longest && streak > 0,
  };
}
