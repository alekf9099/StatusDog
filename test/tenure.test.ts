import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error - a browser module, loaded directly rather than through a build
import { currentStreak, daysBetween, longestStreak, tenureDays, tenureOf } from '../public/assets/office/tenure.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
/** The day-bucket key n days ago, so a fixture can say when records begin. */
const dayKey = (n: number) => day(n).slice(0, 10);

function stats(over: { incidents?: unknown[]; daily?: unknown[] } = {}) {
  return {
    daily: over.daily ?? [{ day: '2026-01-01' }, { day: '2026-08-20' }],
    incidents: over.incidents ?? [],
  };
}

/* ---------------- days ---------------- */

test('whole days, floored, never negative', () => {
  assert.equal(daysBetween(day(47), NOW), 47);
  assert.equal(daysBetween(new Date(NOW - 47.9 * 86_400_000).toISOString(), NOW), 47);
  assert.equal(daysBetween(new Date(NOW + 86_400_000).toISOString(), NOW), 0, 'a future date is not -1 days');
});

test('an unusable date is null rather than a number', () => {
  assert.equal(daysBetween('not a date', NOW), null);
  assert.equal(daysBetween(null, NOW), null);
  assert.equal(daysBetween(undefined, NOW), null);
});

/* ---------------- the current run ---------------- */

test('a healthy target reports how long it has been healthy', () => {
  assert.equal(currentStreak({ state: 'up', since: day(12) }, NOW), 12);
});

test('a target that is down has no streak, and that is not zero', () => {
  // Zero days would read as "it broke today"; the run is simply over.
  assert.equal(currentStreak({ state: 'down', since: day(12) }, NOW), null);
  assert.equal(currentStreak({ state: 'unknown', since: null }, NOW), null);
  assert.equal(currentStreak(null, NOW), null);
});

/* ---------------- the record ---------------- */

test('with no outages the best run is the whole record', () => {
  const best = longestStreak(stats({ daily: [{ day: '2026-06-21' }] }), NOW);
  assert.equal(best, 60, 'records begin 2026-06-21, nothing has gone wrong since');
});

test('the longest gap between outages wins', () => {
  const best = longestStreak(stats({
    daily: [{ day: dayKey(101) }],
    incidents: [
      // A short gap, then a long one, then a short one.
      { startedAt: day(100), endedAt: day(100) },
      { startedAt: day(95), endedAt: day(95) },
      { startedAt: day(10), endedAt: day(10) },
    ],
  }), NOW);
  assert.equal(best, 85, 'the 85-day quiet stretch between the second and third outage');
});

test('the run since the last outage counts, even though it is still going', () => {
  const best = longestStreak(stats({
    daily: [{ day: dayKey(31) }],
    incidents: [{ startedAt: day(30), endedAt: day(30) }],
  }), NOW);
  assert.equal(best, 30, 'nothing since is a real run, not an incomplete one');
});

test('an ongoing outage does not become a streak', () => {
  const best = longestStreak(stats({
    daily: [{ day: '2026-08-13' }],
    incidents: [{ startedAt: day(2), endedAt: null }],
  }), NOW);
  assert.equal(best, 5, 'the five days before it broke, and nothing after');
});

test('overlapping records do not double-count the quiet time', () => {
  const best = longestStreak(stats({
    daily: [{ day: dayKey(51) }],
    incidents: [
      { startedAt: day(50), endedAt: day(20) },
      // Wholly inside the one above: it must not reopen a gap.
      { startedAt: day(40), endedAt: day(35) },
    ],
  }), NOW);
  assert.equal(best, 20);
});

test('a long quiet stretch before an outage counts as the record', () => {
  // Records from January, one outage a month ago: the seven quiet months are the
  // best run this target has, and reporting the shorter recent one would understate it.
  const best = longestStreak(stats({
    daily: [{ day: '2026-01-01' }],
    incidents: [{ startedAt: day(30), endedAt: day(30) }],
  }), NOW);
  assert.equal(best, 201);
});

test('no history means no record, rather than a clean sheet it has not earned', () => {
  assert.equal(longestStreak(stats({ daily: [] }), NOW), null);
  assert.equal(longestStreak(null, NOW), null);
  assert.equal(tenureDays(stats({ daily: [] }), NOW), null);
});

/* ---------------- tenure ---------------- */

test('tenure runs from the first day there is any record', () => {
  assert.equal(tenureDays(stats({ daily: [{ day: '2026-07-21' }, { day: '2026-08-20' }] }), NOW), 30);
});

/* ---------------- together ---------------- */

test('a run that equals the best one is flagged as a record', () => {
  const result = tenureOf(
    { state: 'up', since: day(30) },
    stats({ daily: [{ day: dayKey(31) }], incidents: [{ startedAt: day(30), endedAt: day(30) }] }),
    NOW,
  );
  assert.equal(result.streak, 30);
  assert.equal(result.longest, 30);
  assert.equal(result.record, true);
});

test('a shorter run than the best one is not a record', () => {
  const result = tenureOf(
    { state: 'up', since: day(3) },
    stats({ daily: [{ day: '2026-01-01' }], incidents: [{ startedAt: day(3), endedAt: day(3) }, { startedAt: day(200), endedAt: day(200) }] }),
    NOW,
  );
  assert.equal(result.streak, 3);
  assert.ok((result.longest ?? 0) > 3);
  assert.equal(result.record, false);
});

test('a brand-new dog claims nothing', () => {
  const result = tenureOf({ state: 'unknown', since: null }, stats({ daily: [] }), NOW);
  assert.deepEqual(result, { tenure: null, streak: null, longest: null, record: false });
});

test('day zero is not announced as a record', () => {
  // A target that came up an hour ago has a zero-day streak, which is not news.
  const result = tenureOf(
    { state: 'up', since: new Date(NOW - 3_600_000).toISOString() },
    stats({ daily: [{ day: '2026-08-20' }] }),
    NOW,
  );
  assert.equal(result.streak, 0);
  assert.equal(result.record, false);
});
