import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_STALE_AFTER_MS,
  describeStaleness,
  EMPTY_SCHEDULER_STATE,
  evaluateStaleness,
  recordRun,
  stalenessAlertKind,
  type SchedulerState,
} from '../src/store/scheduler.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

function state(overrides: Partial<SchedulerState> = {}): SchedulerState {
  return { ...EMPTY_SCHEDULER_STATE, ...overrides };
}

/* ---------------- freshness ---------------- */

test('a recent run is not stale', () => {
  const result = evaluateStaleness(state({ lastRunAt: minutesAgo(14) }), NOW);
  assert.equal(result.stale, false);
  assert.equal(result.sinceMs, 14 * 60_000);
  assert.equal(result.missedRuns, 0);
});

test('a gap of three intervals is stale', () => {
  const result = evaluateStaleness(state({ lastRunAt: minutesAgo(50) }), NOW);
  assert.equal(result.stale, true);
  assert.equal(result.missedRuns, 2, '50 minutes is about two skipped runs');
});

test('GitHub delaying a run by half an hour does not raise an alarm', () => {
  // Scheduled workflows are routinely late. The threshold is deliberately three
  // intervals so ordinary lateness stays quiet.
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(30) }), NOW).stale, false);
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(44) }), NOW).stale, false);
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(46) }), NOW).stale, true);
});

test('the default threshold is three missed runs', () => {
  assert.equal(DEFAULT_STALE_AFTER_MS, 45 * 60_000);
});

test('the threshold is configurable', () => {
  const at = minutesAgo(20);
  assert.equal(evaluateStaleness(state({ lastRunAt: at }), NOW, 10 * 60_000).stale, true);
  assert.equal(evaluateStaleness(state({ lastRunAt: at }), NOW, 60 * 60_000).stale, false);
});

test('a never-run scheduler is not "stale" — nothing was promised yet', () => {
  // Alerting on a fresh deployment nobody has wired up would be pure noise; the
  // UI says "no check has run yet" instead.
  const result = evaluateStaleness(state({ lastRunAt: null }), NOW);
  assert.equal(result.stale, false);
  assert.equal(result.sinceMs, null);
  assert.equal(result.lastRunAt, null);
});

test('an unparseable timestamp is treated as never having run', () => {
  const result = evaluateStaleness(state({ lastRunAt: 'yesterday' }), NOW);
  assert.equal(result.stale, false);
  assert.equal(result.sinceMs, null);
});

test('a clock skew into the future does not produce a negative age', () => {
  const result = evaluateStaleness(state({ lastRunAt: new Date(NOW + 60_000).toISOString() }), NOW);
  assert.equal(result.sinceMs, 0);
  assert.equal(result.stale, false);
});

/* ---------------- recording a run ---------------- */

test('recording a run stamps it and clears an outstanding alert', () => {
  const before = state({ lastRunAt: minutesAgo(90), runs: 41, staleNotifiedAt: minutesAgo(30) });
  const after = recordRun(before, minutesAgo(0), 3, 1);

  assert.equal(after.lastRunAt, minutesAgo(0));
  assert.equal(after.lastRunTargets, 3);
  assert.equal(after.lastRunDown, 1);
  assert.equal(after.runs, 42);
  assert.equal(after.staleNotifiedAt, null, 'so the recovery can be reported');
});

test('the run counter starts from nothing without throwing', () => {
  const after = recordRun(state(), minutesAgo(0), 1, 0);
  assert.equal(after.runs, 1);
});

/* ---------------- alerting once per episode ---------------- */

test('going stale alerts once, not once per heartbeat', () => {
  const stale = evaluateStaleness(state({ lastRunAt: minutesAgo(90) }), NOW);

  assert.equal(stalenessAlertKind(state({ lastRunAt: minutesAgo(90) }), stale), 'stale');
  assert.equal(
    stalenessAlertKind(state({ lastRunAt: minutesAgo(90), staleNotifiedAt: minutesAgo(20) }), stale),
    null,
    'already reported',
  );
});

test('coming back alerts once, then goes quiet', () => {
  const fresh = evaluateStaleness(state({ lastRunAt: minutesAgo(5) }), NOW);

  assert.equal(
    stalenessAlertKind(state({ lastRunAt: minutesAgo(5), staleNotifiedAt: minutesAgo(60) }), fresh),
    'recovered',
  );
  assert.equal(stalenessAlertKind(state({ lastRunAt: minutesAgo(5) }), fresh), null);
});

test('a healthy scheduler never alerts', () => {
  const fresh = evaluateStaleness(state({ lastRunAt: minutesAgo(3) }), NOW);
  assert.equal(stalenessAlertKind(state({ lastRunAt: minutesAgo(3) }), fresh), null);
});

test('a never-run scheduler never alerts', () => {
  const never = evaluateStaleness(state(), NOW);
  assert.equal(stalenessAlertKind(state(), never), null);
});

/* ---------------- wording ---------------- */

test('the stale message says how long and what it means', () => {
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(75) }), NOW);
  const message = describeStaleness(staleness, 'stale');

  assert.match(message, /75 minute/);
  assert.match(message, /missed run/);
  assert.match(message, /Nothing is being monitored/, 'the consequence, not just the fact');
});

test('the recovery message is short and unambiguous', () => {
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(2) }), NOW);
  assert.match(describeStaleness(staleness, 'recovered'), /running again/);
});

/* ---------------- who announces what ---------------- */

test('a run can tell it is resuming after a reported outage', async () => {
  const { wasReportedStale } = await import('../src/store/scheduler.js');

  // The division of labour: the heartbeat is the only thing that can notice runs
  // have stopped, and a run is the only thing that can notice they resumed. If
  // recordRun cleared the flag before anyone looked, the all-clear would be lost.
  assert.equal(wasReportedStale(state({ staleNotifiedAt: minutesAgo(60) })), true);
  assert.equal(wasReportedStale(state()), false);

  const resumed = recordRun(state({ staleNotifiedAt: minutesAgo(60) }), minutesAgo(0), 3, 0);
  assert.equal(resumed.staleNotifiedAt, null, 'the episode is closed once announced');
  assert.equal(wasReportedStale(resumed), false);
});
