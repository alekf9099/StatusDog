import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findVantageReport,
  isDisputable,
  MAX_CONSECUTIVE_DISPUTES,
  nextDisputeCount,
  reconcile,
  vantageSaysOk,
  type VantagePayload,
  type VantageReport,
} from '../src/monitor/vantage.js';
import type { ExpectStatus, FailureReason, ProbeResult, ResolvedTarget } from '../src/config/types.js';
import { resolveConfig } from '../src/config/index.js';
import type { KvClient } from '../src/store/kv.js';
import { applyCheck, readEntry, statsFor } from '../src/store/uptime.js';

const OK: ExpectStatus[] = ['2xx'];

function report(over: Partial<VantageReport> = {}): VantageReport {
  return { id: 'a', reachable: true, status: 200, ...over };
}

/* ---------------- reading the runner's report ---------------- */

test('the runner only measures; whether a status is healthy is decided here', () => {
  // 301 is healthy for a target that expects a redirect and not for one that does not,
  // and the runner cannot know which — so it reports the raw number either way.
  assert.equal(vantageSaysOk(report({ status: 301 }), ['2xx']), false);
  assert.equal(vantageSaysOk(report({ status: 301 }), ['3xx']), true);
  assert.equal(vantageSaysOk(report({ status: 404 }), [404]), true);
});

test('unreachable is not healthy, whatever the status field says', () => {
  assert.equal(vantageSaysOk(report({ reachable: false, status: 200 }), OK), false);
  assert.equal(vantageSaysOk(report({ status: null }), OK), false);
  assert.equal(vantageSaysOk(null, OK), false);
});

test('a nonsense status is treated as no answer rather than as a pass', () => {
  assert.equal(vantageSaysOk(report({ status: Number.NaN }), OK), false);
  assert.equal(vantageSaysOk(report({ status: Infinity }), OK), false);
});

test('reports are matched by id, and a missing one is null not undefined', () => {
  const payload: VantagePayload = {
    name: 'github-actions',
    checks: [report({ id: 'a' }), report({ id: 'b', status: 500 })],
  };
  assert.equal(findVantageReport(payload, 'b')?.status, 500);
  assert.equal(findVantageReport(payload, 'missing'), null);
  assert.equal(findVantageReport(null, 'a'), null);
  assert.equal(findVantageReport({ name: 'x' } as VantagePayload, 'a'), null, 'no checks array');
});

/* ---------------- agreement and disagreement ---------------- */

test('with no second opinion the primary stands alone', () => {
  const verdict = reconcile({
    primaryOk: false,
    report: null,
    expectStatus: OK,
    reason: 'timeout',
    consecutiveDisputes: 0,
  });
  assert.equal(verdict.outcome, 'unwitnessed');
  assert.equal(verdict.conclusive, true, 'a missing runner must never mute an outage');
});

test('both vantage points seeing it work is unremarkable', () => {
  const verdict = reconcile({ primaryOk: true, report: report(), expectStatus: OK, consecutiveDisputes: 0 });
  assert.equal(verdict.outcome, 'confirmed-ok');
  assert.equal(verdict.conclusive, true);
  assert.equal(verdict.note, null);
});

test('an outage two networks agree on is conclusive', () => {
  const verdict = reconcile({
    primaryOk: false,
    report: report({ reachable: false, status: null }),
    expectStatus: OK,
    reason: 'timeout',
    consecutiveDisputes: 0,
  });
  assert.equal(verdict.outcome, 'confirmed-failed');
  assert.equal(verdict.conclusive, true);
  assert.match(verdict.note ?? '', /both vantage points/i);
});

test('the transpacific false alarm is now inconclusive instead of an outage', () => {
  // The real incident: ~200ms from Seoul, 30s and a timeout from US-East.
  const verdict = reconcile({
    primaryOk: false,
    report: report(),
    expectStatus: OK,
    reason: 'timeout',
    consecutiveDisputes: 0,
    vantageName: 'github-actions',
  });
  assert.equal(verdict.outcome, 'disputed');
  assert.equal(verdict.conclusive, false);
  assert.match(verdict.note ?? '', /github-actions/);
  assert.match(verdict.note ?? '', /nobody is paged/);
});

test('the primary decides the state when only the second vantage fails', () => {
  const verdict = reconcile({
    primaryOk: true,
    report: report({ reachable: false, status: null }),
    expectStatus: OK,
    consecutiveDisputes: 0,
  });
  assert.equal(verdict.outcome, 'secondary-disagrees');
  assert.equal(verdict.conclusive, true, 'the region serving the dashboard is the one that counts');
  assert.ok(verdict.note, 'still worth recording — it is the early warning for a routing problem');
});

/* ---------------- only network failures can be disputed ---------------- */

test('a failure in the response itself is never suppressed', () => {
  // The runner sees HTTP 200 and reports it healthy. It is not: the page said
  // "502 Bad Gateway" in its body. A second network cannot overrule that.
  const contentReasons: FailureReason[] = ['status', 'body', 'header', 'redirect', 'invalid-url'];
  for (const reason of contentReasons) {
    const verdict = reconcile({
      primaryOk: false,
      report: report(),
      expectStatus: OK,
      reason,
      consecutiveDisputes: 0,
    });
    assert.equal(verdict.outcome, 'content-failure', `${reason} must not be disputable`);
    assert.equal(verdict.conclusive, true);
    assert.match(verdict.note ?? '', new RegExp(reason));
  }
});

test('reasons the network could plausibly have caused are the disputable ones', () => {
  for (const reason of ['timeout', 'dns', 'refused', 'network', 'slow', 'tls'] as FailureReason[]) {
    assert.equal(isDisputable(reason), true, reason);
  }
  for (const reason of ['status', 'body', 'header', 'redirect', 'invalid-url'] as FailureReason[]) {
    assert.equal(isDisputable(reason), false, reason);
  }
  assert.equal(isDisputable(null), false);
  assert.equal(isDisputable(undefined), false);
});

test('an unknown reason is not disputable, so a new failure kind pages by default', () => {
  const verdict = reconcile({
    primaryOk: false,
    report: report(),
    expectStatus: OK,
    reason: 'something-new' as FailureReason,
    consecutiveDisputes: 0,
  });
  assert.equal(verdict.conclusive, true);
});

/* ---------------- the fail-open guard ---------------- */

test('a second vantage cannot mute a real outage forever', () => {
  const inputs = { primaryOk: false, report: report(), expectStatus: OK, reason: 'timeout' as FailureReason };

  for (let already = 0; already < MAX_CONSECUTIVE_DISPUTES; already++) {
    const verdict = reconcile({ ...inputs, consecutiveDisputes: already });
    assert.equal(verdict.outcome, 'disputed', `dispute ${already + 1} is still suppressed`);
  }

  const exhausted = reconcile({ ...inputs, consecutiveDisputes: MAX_CONSECUTIVE_DISPUTES });
  assert.equal(exhausted.outcome, 'dispute-exhausted');
  assert.equal(exhausted.conclusive, true, 'the failure now counts');
  assert.match(exhausted.note ?? '', /may itself be wrong/);
});

test('the dispute run resets only when the second vantage agrees again', () => {
  assert.equal(nextDisputeCount(2, 'disputed'), 3);
  assert.equal(nextDisputeCount(2, 'confirmed-ok'), 0);
  assert.equal(nextDisputeCount(2, 'confirmed-failed'), 0);
  assert.equal(
    nextDisputeCount(2, 'dispute-exhausted'),
    3,
    'the disagreement is still going, so the run keeps growing rather than resetting',
  );
  assert.equal(nextDisputeCount(2, 'content-failure'), 0);
  assert.equal(nextDisputeCount(Number.NaN, 'disputed'), 1, 'a corrupt counter starts over');
  assert.equal(nextDisputeCount(-5, 'disputed'), 1);
});

/* ---------------- what the state machine does with an inconclusive check ---------------- */

/** In-memory stand-in with the same contract as the REST client. */
function fakeKv(): KvClient {
  const data = new Map<string, string>();
  return {
    origin: 'memory',
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

function statusdogTarget(): ResolvedTarget {
  return resolveConfig({
    targets: [{
      id: 'api',
      name: 'API',
      url: 'https://example.com',
      failureThreshold: 2,
      recoveryThreshold: 1,
    }],
  }).targets[0]!;
}

function probeResult(ok: boolean, checkedAt: string, reason: FailureReason | null = 'timeout'): ProbeResult {
  return {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    ok,
    status: ok ? 200 : null,
    responseTimeMs: ok ? 42 : 15_000,
    redirects: 0,
    checkedAt,
    reason: ok ? null : reason,
    message: ok ? null : 'Timed out',
    detail: null,
  };
}

test('a suppressed failure leaves the state and the streak exactly where they were', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();

  await applyCheck(kv, target, probeResult(true, '2026-08-20T00:00:00.000Z'));

  // Two failures in a row would normally trip failureThreshold: 2. Disputed, they
  // must not — otherwise suppression would only delay the false alarm by one check.
  for (const at of ['2026-08-20T00:15:00.000Z', '2026-08-20T00:30:00.000Z']) {
    const applied = await applyCheck(kv, target, probeResult(false, at), { inconclusive: true });
    assert.equal(applied.transitioned, false);
    assert.equal(applied.entry.state, 'up');
    assert.equal(applied.entry.consecutiveFailures, 0, 'the streak must not advance');
  }

  const entry = await readEntry(kv, target);
  assert.equal(entry.state, 'up');
  assert.equal(entry.consecutiveDisputes, 2);
  assert.equal(entry.disputes, 2);

  // What the dashboard shows must match what was concluded: the last result that
  // counted, not a failure we have just declared uninterpretable.
  assert.equal(entry.lastResult?.ok, true);
  assert.equal(entry.lastResult?.checkedAt, '2026-08-20T00:00:00.000Z');

  // The disagreement is not swept away either.
  assert.equal(entry.lastDispute?.at, '2026-08-20T00:30:00.000Z');
  assert.equal(entry.lastDispute?.reason, 'timeout');

  // The raw history still shows what happened — a dispute is visible, not erased.
  assert.equal(entry.history.length, 3);
  assert.deepEqual(
    entry.history.map((point) => point.reason),
    [null, 'disputed', 'disputed'],
  );
  assert.deepEqual(entry.history.map((point) => point.ok), [true, false, false]);
});

test('once a failure counts, the streak starts from one rather than from the disputes', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();

  await applyCheck(kv, target, probeResult(true, '2026-08-20T00:00:00.000Z'));
  await applyCheck(kv, target, probeResult(false, '2026-08-20T00:15:00.000Z'), { inconclusive: true });

  const counted = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:30:00.000Z'));
  assert.equal(counted.entry.consecutiveFailures, 1);
  assert.equal(counted.entry.state, 'up', 'still one short of the threshold');
  assert.equal(counted.entry.consecutiveDisputes, 0, 'a conclusive check clears the run');

  const tripped = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:45:00.000Z'));
  assert.equal(tripped.entry.state, 'down');
  assert.equal(tripped.transitioned, true, 'a genuine outage still pages');
});

test('a conclusive check takes the displayed result back over', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();

  await applyCheck(kv, target, probeResult(true, '2026-08-20T00:00:00.000Z'));
  await applyCheck(kv, target, probeResult(false, '2026-08-20T00:15:00.000Z'), { inconclusive: true });
  const counted = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:30:00.000Z'));

  assert.equal(counted.entry.lastResult?.checkedAt, '2026-08-20T00:30:00.000Z');
  assert.equal(counted.entry.lastResult?.ok, false, 'a failure that counts is shown as a failure');
  assert.equal(
    counted.entry.lastDispute?.at,
    '2026-08-20T00:15:00.000Z',
    'the earlier disagreement stays on the record',
  );
});

test('a broken runner delays the page by the guard and no longer', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();

  // A runner whose own network is broken would report every target as reachable
  // forever. Once its patience is exhausted the run keeps growing, so it does not
  // get to suppress every fourth check indefinitely.
  await applyCheck(kv, target, probeResult(false, '2026-08-20T00:00:00.000Z'), {
    inconclusive: true,
    disputeRun: 3,
  });
  assert.equal((await readEntry(kv, target)).consecutiveDisputes, 3);

  // Exhausted: the failure counts, and the run is still going.
  const counted = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:15:00.000Z'), {
    inconclusive: false,
    disputeRun: nextDisputeCount(3, 'dispute-exhausted'),
  });
  assert.equal(counted.entry.consecutiveFailures, 1);
  assert.equal(counted.entry.consecutiveDisputes, 4, 'still disagreeing, so still not believed');

  const down = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:30:00.000Z'), {
    inconclusive: false,
    disputeRun: nextDisputeCount(4, 'dispute-exhausted'),
  });
  assert.equal(down.entry.state, 'down', 'a genuine outage still pages, three checks late');

  // And the moment the second vantage agrees again, the run ends.
  const agreed = await applyCheck(kv, target, probeResult(false, '2026-08-20T00:45:00.000Z'), {
    disputeRun: nextDisputeCount(5, 'confirmed-failed'),
  });
  assert.equal(agreed.entry.consecutiveDisputes, 0);
});

test('a disputed check stays out of the uptime figures', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();

  await applyCheck(kv, target, probeResult(true, '2026-08-20T00:00:00.000Z'));
  await applyCheck(kv, target, probeResult(true, '2026-08-20T00:15:00.000Z'));
  await applyCheck(kv, target, probeResult(false, '2026-08-20T00:30:00.000Z'), { inconclusive: true });

  const stats = statsFor(await readEntry(kv, target));
  assert.equal(stats.checks, 2, 'the disputed check is not a check that counted');
  assert.equal(stats.failures, 0);
  assert.equal(stats.uptimePct, 100, 'counting it would put the false alarm straight back in');
  assert.equal(stats.avgResponseTimeMs, 42, 'and its timed-out duration would drag the average');
});

test('nothing but disputes reports no data rather than zero uptime', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();
  await applyCheck(kv, target, probeResult(false, '2026-08-20T00:15:00.000Z'), { inconclusive: true });

  const stats = statsFor(await readEntry(kv, target));
  assert.equal(stats.checks, 0);
  assert.equal(stats.uptimePct, null, 'no data is not 0%');
  assert.equal(
    stats.lastCheckedAt,
    '2026-08-20T00:15:00.000Z',
    'something did happen, even if nothing could be concluded from it',
  );
});

test('an entry written before disputes existed reads back with zeroes, not NaN', async () => {
  const kv = fakeKv();
  const target = statusdogTarget();
  await kv.set(
    `statusdog:v1:target:${target.id}`,
    JSON.stringify({ state: 'up', since: '2026-08-01T00:00:00.000Z', history: [] }),
  );

  const entry = await readEntry(kv, target);
  assert.equal(entry.consecutiveDisputes, 0);
  assert.equal(entry.disputes, 0);
});
