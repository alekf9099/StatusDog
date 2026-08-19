import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProbeResult } from '../src/config/types.js';
import {
  applyTransition,
  bucketIndexOf,
  DAILY_LIMIT,
  dayKeyOf,
  emptyStats,
  foldCheck,
  INCIDENT_LIMIT,
  LATENCY_BUCKETS,
  shiftDay,
  summarize,
  type TargetStats,
} from '../src/store/rollup.js';

const KST = 540;

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    ok: true,
    status: 200,
    responseTimeMs: 120,
    redirects: 0,
    checkedAt: '2026-08-19T03:00:00.000Z',
    reason: null,
    message: null,
    detail: null,
    ...overrides,
  };
}

/** Fold a run of checks, all on the same day, at a fixed latency. */
function fill(stats: TargetStats, day: string, count: number, ms: number, ok = true): TargetStats {
  let next = stats;
  for (let i = 0; i < count; i++) {
    next = foldCheck(next, result({
      ok,
      responseTimeMs: ms,
      checkedAt: `${day}T06:${String(i % 60).padStart(2, '0')}:00.000Z`,
      reason: ok ? null : 'status',
    }));
  }
  return next;
}

/* ---------------- day boundaries ---------------- */

test('a day boundary can follow the team rather than UTC', () => {
  // 2026-08-19T20:00Z is already the 20th in Seoul. A Korean team reading
  // "20일 가동률" means their 20th.
  assert.equal(dayKeyOf('2026-08-19T20:00:00.000Z', 0), '2026-08-19');
  assert.equal(dayKeyOf('2026-08-19T20:00:00.000Z', KST), '2026-08-20');

  // And just before the Seoul boundary it is still the 19th.
  assert.equal(dayKeyOf('2026-08-19T14:59:00.000Z', KST), '2026-08-19');
  assert.equal(dayKeyOf('2026-08-19T15:00:00.000Z', KST), '2026-08-20');
});

test('an unparseable timestamp does not become a bucket named "NaN"', () => {
  assert.equal(dayKeyOf('not a date', KST), 'invalid');
});

test('shiftDay walks across month and year ends', () => {
  assert.equal(shiftDay('2026-08-19', -1), '2026-08-18');
  assert.equal(shiftDay('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftDay('2026-08-19', 0), '2026-08-19');
});

/* ---------------- latency histogram ---------------- */

test('a latency lands in the bucket that contains it', () => {
  assert.equal(bucketIndexOf(0), 0);
  assert.equal(bucketIndexOf(25), 0);
  assert.equal(bucketIndexOf(26), 1);
  assert.equal(bucketIndexOf(100), 3);
  assert.equal(bucketIndexOf(12800), LATENCY_BUCKETS.length - 2);
  assert.equal(bucketIndexOf(999_999), LATENCY_BUCKETS.length - 1, 'the top bucket is open-ended');
});

test('the buckets are fine enough to separate p50 from p95 on a fast site', () => {
  // The reason for the weighting: a site between 90ms and 160ms used to land
  // entirely in one bucket, which made every percentile identical.
  assert.notEqual(bucketIndexOf(90), bucketIndexOf(160));
  assert.notEqual(bucketIndexOf(120), bucketIndexOf(190));
});

test('a negative or absurd latency does not corrupt the histogram', () => {
  assert.equal(bucketIndexOf(-5), 0);
  assert.equal(bucketIndexOf(NaN), 0);
});

/* ---------------- folding ---------------- */

test('folding a check builds the day it belongs to', () => {
  const stats = foldCheck(emptyStats('api', KST), result({ responseTimeMs: 150 }));

  assert.equal(stats.daily.length, 1);
  const bucket = stats.daily[0]!;
  assert.equal(bucket.day, '2026-08-19', '03:00Z is still the 19th in Seoul');
  assert.equal(bucket.checks, 1);
  assert.equal(bucket.failures, 0);
  assert.equal(bucket.sumMs, 150);
  assert.equal(bucket.maxMs, 150);
  assert.equal(bucket.histogram[bucketIndexOf(150)], 1);
});

test('a failed check counts against the day but not against latency', () => {
  const stats = foldCheck(emptyStats('api'), result({ ok: false, reason: 'timeout', responseTimeMs: 30000 }));
  const bucket = stats.daily[0]!;

  assert.equal(bucket.checks, 1);
  assert.equal(bucket.failures, 1);
  assert.equal(bucket.sumMs, 0, 'a 30s timeout must not drag the average of *successful* responses');
  assert.equal(bucket.histogram.reduce((a, b) => a + b, 0), 0);
});

test('checks accumulate into the same bucket and separate days stay separate', () => {
  let stats = fill(emptyStats('api'), '2026-08-18', 4, 100);
  stats = fill(stats, '2026-08-19', 6, 200);

  assert.deepEqual(stats.daily.map((b) => b.day), ['2026-08-18', '2026-08-19']);
  assert.equal(stats.daily[0]!.checks, 4);
  assert.equal(stats.daily[1]!.checks, 6);
});

test('buckets stay sorted even when checks arrive out of order', () => {
  let stats = foldCheck(emptyStats('api'), result({ checkedAt: '2026-08-19T06:00:00.000Z' }));
  stats = foldCheck(stats, result({ checkedAt: '2026-08-17T06:00:00.000Z' }));
  stats = foldCheck(stats, result({ checkedAt: '2026-08-18T06:00:00.000Z' }));

  assert.deepEqual(stats.daily.map((b) => b.day), ['2026-08-17', '2026-08-18', '2026-08-19']);
});

test('downtime is attributed to the gap the target was already down for', () => {
  const stats = foldCheck(emptyStats('api'), result({ ok: false, reason: 'timeout' }), {
    previousState: 'down',
    elapsedMs: 15 * 60_000,
  });
  assert.equal(stats.daily[0]!.downtimeMs, 15 * 60_000);
});

test('a target that was up contributes no downtime for the gap', () => {
  const stats = foldCheck(emptyStats('api'), result({ ok: false }), {
    previousState: 'up',
    elapsedMs: 15 * 60_000,
  });
  assert.equal(stats.daily[0]!.downtimeMs, 0, 'the outage is only confirmed from here on');
});

test('a scheduler that was off for a week does not invent a week of downtime', () => {
  // Only observed intervals count. Without the cap, restarting a paused scheduler
  // would report an outage nobody measured.
  const stats = foldCheck(emptyStats('api'), result({ ok: false }), {
    previousState: 'down',
    elapsedMs: 7 * 86_400_000,
  });
  assert.equal(stats.daily[0]!.downtimeMs, 6 * 3_600_000, 'capped at six hours per interval');
});

test('daily buckets are capped, keeping the most recent', () => {
  let stats = emptyStats('api');
  for (let i = 0; i < DAILY_LIMIT + 20; i++) {
    stats = foldCheck(stats, result({ checkedAt: `${shiftDay('2025-01-01', i)}T06:00:00.000Z` }));
  }
  assert.equal(stats.daily.length, DAILY_LIMIT);
  assert.equal(stats.daily.at(-1)!.day, shiftDay('2025-01-01', DAILY_LIMIT + 19));
});

test('a bucket written by an older version is tolerated', () => {
  const legacy = {
    ...emptyStats('api'),
    daily: [{ day: '2026-08-18', checks: 3 } as never],
  };
  const stats = foldCheck(legacy, result());
  assert.equal(stats.daily.length, 2);
  assert.equal(stats.daily[0]!.failures, 0, 'missing fields read as zero');
  assert.equal(stats.daily[0]!.histogram.length, LATENCY_BUCKETS.length);
});

/* ---------------- incidents ---------------- */

test('going down opens an incident and coming back closes it', () => {
  let stats = applyTransition(
    emptyStats('api'),
    'down',
    '2026-08-19T03:00:00.000Z',
    result({ ok: false, status: null, reason: 'timeout', message: 'Timed out after 29998ms' }),
  );

  assert.equal(stats.incidents.length, 1);
  assert.equal(stats.incidents[0]!.endedAt, null, 'still going on');
  assert.equal(stats.incidents[0]!.reason, 'timeout');
  assert.equal(stats.incidents[0]!.message, 'Timed out after 29998ms');

  stats = applyTransition(stats, 'up', '2026-08-19T03:45:00.000Z', result());
  assert.equal(stats.incidents[0]!.endedAt, '2026-08-19T03:45:00.000Z');
  assert.equal(stats.incidents[0]!.durationMs, 45 * 60_000);
});

test('a second "down" does not open a duplicate incident', () => {
  let stats = applyTransition(emptyStats('api'), 'down', '2026-08-19T03:00:00.000Z', result({ ok: false }));
  stats = applyTransition(stats, 'down', '2026-08-19T03:15:00.000Z', result({ ok: false }));
  assert.equal(stats.incidents.length, 1);
  assert.equal(stats.incidents[0]!.startedAt, '2026-08-19T03:00:00.000Z');
});

test('an "up" with nothing open is ignored rather than closing history', () => {
  let stats = applyTransition(emptyStats('api'), 'down', '2026-08-01T00:00:00.000Z', result({ ok: false }));
  stats = applyTransition(stats, 'up', '2026-08-01T01:00:00.000Z', result());
  const closed = stats.incidents[0]!.endedAt;

  stats = applyTransition(stats, 'up', '2026-08-05T00:00:00.000Z', result());
  assert.equal(stats.incidents.length, 1);
  assert.equal(stats.incidents[0]!.endedAt, closed, 'the closed incident is untouched');
});

test('the incident list is capped', () => {
  let stats = emptyStats('api');
  for (let i = 0; i < INCIDENT_LIMIT + 10; i++) {
    stats = applyTransition(stats, 'down', `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`, result({ ok: false }));
    stats = applyTransition(stats, 'up', `2026-01-01T01:${String(i % 60).padStart(2, '0')}:00.000Z`, result());
  }
  assert.equal(stats.incidents.length, INCIDENT_LIMIT);
});

/* ---------------- summaries ---------------- */

test('a week summary covers seven days and no more', () => {
  let stats = emptyStats('api', KST);
  for (let i = 0; i < 14; i++) {
    stats = fill(stats, shiftDay('2026-08-06', i), 10, 100);
  }

  const week = summarize(stats, 7, '2026-08-19');
  assert.equal(week.daysWithData, 7);
  assert.equal(week.from, '2026-08-13');
  assert.equal(week.to, '2026-08-19');
  assert.equal(week.checks, 70);
});

test('uptime and averages are computed over the window', () => {
  let stats = fill(emptyStats('api'), '2026-08-19', 9, 100, true);
  stats = fill(stats, '2026-08-19', 1, 0, false);

  const day = summarize(stats, 1, '2026-08-19');
  assert.equal(day.checks, 10);
  assert.equal(day.failures, 1);
  assert.equal(day.uptimePct, 90);
  assert.equal(day.avgMs, 100, 'averaged over successes, not over all checks');
});

test('percentiles come from the merged histogram and are mergeable across days', () => {
  // 90 fast days' worth and 10 slow ones: p50 sits low, p95 sits high. An average
  // could not tell these apart from a uniform middle.
  let stats = fill(emptyStats('api'), '2026-08-18', 90, 90);
  stats = fill(stats, '2026-08-19', 10, 3000);

  const week = summarize(stats, 7, '2026-08-19');
  assert.equal(week.p50Ms, 100, 'the bucket containing the median');
  assert.equal(week.p95Ms, 3200, 'the bucket containing the 95th percentile');
  assert.ok(week.p95Ms! > week.p50Ms!);
});

test('an empty window reports null rather than zero', () => {
  const summary = summarize(emptyStats('api'), 30, '2026-08-19');
  assert.equal(summary.checks, 0);
  assert.equal(summary.uptimePct, null, 'zero uptime and no data are different things');
  assert.equal(summary.avgMs, null);
  assert.equal(summary.p50Ms, null);
  assert.equal(summary.from, null);
  assert.equal(summary.daysWithData, 0);
});

test('a window with gaps reports how many days actually had data', () => {
  let stats = fill(emptyStats('api'), '2026-08-19', 5, 100);
  stats = fill(stats, '2026-08-14', 5, 100);

  const week = summarize(stats, 7, '2026-08-19');
  assert.equal(week.daysWithData, 2, 'so a 100% figure from two days is not read as a full week');
  assert.equal(week.checks, 10);
});

test('downtime and incident counts are summed over the window', () => {
  let stats = emptyStats('api', KST);
  stats = foldCheck(stats, result({ ok: false, checkedAt: '2026-08-19T06:00:00.000Z' }), {
    previousState: 'down',
    elapsedMs: 30 * 60_000,
  });
  stats = applyTransition(stats, 'down', '2026-08-19T06:00:00.000Z', result({ ok: false }));

  const day = summarize(stats, 1, '2026-08-19');
  assert.equal(day.downtimeMs, 30 * 60_000);
  assert.equal(day.incidents, 1);
});

test('an incident outside the window is not counted in it', () => {
  let stats = applyTransition(emptyStats('api', KST), 'down', '2026-07-01T06:00:00.000Z', result({ ok: false }));
  stats = fill(stats, '2026-08-19', 5, 100);

  assert.equal(summarize(stats, 7, '2026-08-19').incidents, 0);
  assert.equal(summarize(stats, 90, '2026-08-19').incidents, 1);
});

test('a month summary is what a monthly report would quote', () => {
  let stats = emptyStats('api', KST);
  for (let i = 0; i < 30; i++) {
    const day = shiftDay('2026-07-21', i);
    // One bad day in thirty.
    if (i === 10) stats = fill(stats, day, 96, 0, false);
    else stats = fill(stats, day, 96, 120);
  }

  const month = summarize(stats, 30, '2026-08-19');
  assert.equal(month.daysWithData, 30);
  assert.equal(month.checks, 30 * 96);
  assert.equal(month.failures, 96);
  assert.equal(month.uptimePct, 96.67, 'one day out of thirty');
  assert.equal(month.avgMs, 120);
});
