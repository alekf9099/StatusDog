import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeStaleness,
  FALLBACK_INTERVAL_MS,
  GAP_SAMPLE_SIZE,
  MAX_STALE_AFTER_MS,
  MIN_STALE_AFTER_MS,
  observedIntervalMs,
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

/** Enough identical gaps to pass the minimum-sample gate. */
function gaps(minutes: number, count = 8): number[] {
  return new Array(count).fill(minutes * 60_000);
}

/* ---------------- freshness ---------------- */

test('a recent run is not stale', () => {
  const result = evaluateStaleness(state({ lastRunAt: minutesAgo(14) }), NOW);
  assert.equal(result.stale, false);
  assert.equal(result.sinceMs, 14 * 60_000);
  assert.equal(result.missedRuns, 0);
});

test('a gap of three measured intervals is stale', () => {
  const result = evaluateStaleness(state({ lastRunAt: minutesAgo(110), recentGapsMs: gaps(32) }), NOW);
  assert.equal(result.stale, true);
  assert.equal(result.missedRuns, 2, 'counted at the measured cadence, not an assumed one');
});

test('GitHub delaying a run does not raise an alarm', () => {
  // Scheduled workflows are routinely late; the threshold is three intervals so
  // ordinary lateness stays quiet. These minutes are gaps actually observed here.
  const measured = { recentGapsMs: gaps(32) };
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(30), ...measured }), NOW).stale, false);
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(52), ...measured }), NOW).stale, false, 'the gap that used to false-alarm');
  assert.equal(evaluateStaleness(state({ lastRunAt: minutesAgo(58), ...measured }), NOW).stale, false, 'the worst gap seen');
});

test('with no history at all the fallback cadence is used', () => {
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(10) }), NOW);
  assert.equal(staleness.intervalSource, 'fallback');
  assert.equal(staleness.intervalMs, FALLBACK_INTERVAL_MS);
});

test('a bare threshold argument still works, for older callers', () => {
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
  const before = state({ lastRunAt: minutesAgo(200), runs: 41, staleNotifiedAt: minutesAgo(30) });
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
  const stale = evaluateStaleness(state({ lastRunAt: minutesAgo(200) }), NOW);

  assert.equal(stalenessAlertKind(state({ lastRunAt: minutesAgo(200) }), stale), 'stale');
  assert.equal(
    stalenessAlertKind(state({ lastRunAt: minutesAgo(200), staleNotifiedAt: minutesAgo(20) }), stale),
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
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(150), recentGapsMs: gaps(32) }), NOW);
  const message = describeStaleness(staleness, 'stale');

  assert.match(message, /150 minute/);
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

/* ---------------- learning the cadence ---------------- */

test('the cadence is measured from the gaps between runs', () => {
  // The workflow asks GitHub for a run every 15 minutes. Over 28 observed runs on
  // this repo GitHub actually delivered one every 32 minutes on median, with gaps
  // up to 58. Judging staleness against the requested rate fired on a healthy
  // scheduler, so the interval is learned instead.
  const observed = [32, 33, 30, 36, 22, 58, 46, 35, 43].map((m) => m * 60_000);
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(40), recentGapsMs: observed }), NOW);

  assert.equal(staleness.intervalSource, 'observed');
  assert.equal(staleness.intervalMs, 35 * 60_000, 'the median of the samples');
  assert.equal(staleness.stale, false, '40 minutes is one late run, not a stopped scheduler');
});

test('a threshold of three measured intervals rides out real GitHub lateness', () => {
  const observed = new Array(8).fill(32 * 60_000);
  const at = (minutes: number) =>
    evaluateStaleness(state({ lastRunAt: minutesAgo(minutes), recentGapsMs: observed }), NOW);

  assert.equal(at(58).stale, false, 'the worst gap actually seen must not alarm');
  assert.equal(at(90).stale, false);
  assert.equal(at(100).stale, true, 'three missed intervals is stopped, not late');
});

test('with too few samples it falls back rather than trusting one gap', () => {
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(10), recentGapsMs: [60_000] }), NOW);
  assert.equal(staleness.intervalSource, 'fallback');
  assert.equal(staleness.intervalMs, FALLBACK_INTERVAL_MS);
});

test('a four-hour outage does not become the new normal', () => {
  // Without the credibility filter, one long gap would double the median and blind
  // the switch for the rest of the day.
  // Five credible samples plus one implausible gap; the median of the five is 30.
  const withOutage = [30, 31, 29, 32, 30, 600].map((m) => m * 60_000);
  assert.equal(observedIntervalMs(state({ recentGapsMs: withOutage })), 30 * 60_000);

  // The case the filter really earns its keep on: the scheduler was broken all day,
  // so *every* recent gap is an outage. Trusting those would push the threshold to
  // its six-hour ceiling and blind the switch for the rest of the week.
  const allOutages = state({ recentGapsMs: [600, 700, 650, 620, 660].map((m) => m * 60_000) });
  assert.equal(observedIntervalMs(allOutages), null, 'no credible evidence of a cadence');
  assert.equal(evaluateStaleness(allOutages, NOW).intervalSource, 'fallback');
});

test('a median resists a single freak sample', () => {
  const gaps = [30, 31, 120, 29, 30].map((m) => m * 60_000);
  assert.equal(observedIntervalMs(state({ recentGapsMs: gaps })), 30 * 60_000);
});

test('the threshold has a floor and a ceiling', () => {
  const fast = new Array(6).fill(60_000);
  assert.equal(
    evaluateStaleness(state({ lastRunAt: minutesAgo(1), recentGapsMs: fast }), NOW).staleAfterMs,
    MIN_STALE_AFTER_MS,
    'a one-minute cadence must not make a three-minute threshold',
  );

  const slow = new Array(6).fill(3 * 3_600_000);
  assert.equal(
    evaluateStaleness(state({ lastRunAt: minutesAgo(1), recentGapsMs: slow }), NOW).staleAfterMs,
    MAX_STALE_AFTER_MS,
    'and a slow one must not make the switch useless',
  );
});

test('an explicit threshold still wins', () => {
  const observed = new Array(8).fill(32 * 60_000);
  const staleness = evaluateStaleness(
    state({ lastRunAt: minutesAgo(40), recentGapsMs: observed }),
    NOW,
    { staleAfterMs: 20 * 60_000 },
  );
  assert.equal(staleness.intervalSource, 'configured');
  assert.equal(staleness.stale, true);
});

test('recording a run appends the gap it just closed', () => {
  const before = state({ lastRunAt: minutesAgo(31), recentGapsMs: [30 * 60_000] });
  const after = recordRun(before, minutesAgo(0), 3, 0);
  assert.deepEqual(after.recentGapsMs, [30 * 60_000, 31 * 60_000]);
});

test('the first run ever records no gap', () => {
  assert.deepEqual(recordRun(state(), minutesAgo(0), 3, 0).recentGapsMs, []);
});

test('a clock that went backwards contributes no gap', () => {
  const before = state({ lastRunAt: minutesAgo(-5) });
  assert.deepEqual(recordRun(before, minutesAgo(0), 3, 0).recentGapsMs, []);
});

test('the gap window is bounded', () => {
  let current = state({ lastRunAt: minutesAgo(GAP_SAMPLE_SIZE + 10) });
  for (let i = GAP_SAMPLE_SIZE + 9; i >= 0; i--) {
    current = recordRun(current, minutesAgo(i), 3, 0);
  }
  assert.equal(current.recentGapsMs.length, GAP_SAMPLE_SIZE);
});

test('corrupt gap samples are dropped rather than trusted', () => {
  const messy = state({ recentGapsMs: ['30', null, -5, 0, NaN, 1_800_000] as unknown as number[] });
  assert.equal(observedIntervalMs(messy), null, 'one usable sample is not a median');
  assert.doesNotThrow(() => evaluateStaleness(messy, NOW));
});

test('the stale message quotes the cadence it judged against', () => {
  const observed = new Array(8).fill(32 * 60_000);
  const staleness = evaluateStaleness(state({ lastRunAt: minutesAgo(150), recentGapsMs: observed }), NOW);
  const message = describeStaleness(staleness, 'stale');

  assert.match(message, /150 minute/);
  assert.match(message, /every 32 minute/, 'so the reader can tell late from stopped');
});
