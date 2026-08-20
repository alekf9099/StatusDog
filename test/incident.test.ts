import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  attachAlerts,
  closeInLog,
  closeReport,
  diffSnapshots,
  emptyLog,
  failureRunOf,
  openInLog,
  openReport,
  openReportOf,
  PRECURSOR_POINTS,
  REPORT_LIMIT,
  snapshotOf,
  type IncidentSnapshot,
} from '../src/store/incident.js';
import type { UptimeRecord } from '../src/store/uptime.js';
import type { ProbeResult } from '../src/config/types.js';
import { excerptOf, probeUrl } from '../src/monitor/probe.js';
import { startTestServer } from './helpers.js';

function result(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    ok: false,
    status: 503,
    responseTimeMs: 1200,
    redirects: 0,
    checkedAt: '2026-08-20T03:00:00.000Z',
    reason: 'status',
    message: 'Unexpected status 503',
    detail: {
      headers: { server: 'nginx', 'content-type': 'text/html' },
      tls: null,
      chain: [],
      peer: '10.0.0.1',
      bodySize: 512,
      bodyExcerpt: '502 Bad Gateway',
    },
    ...over,
  };
}

function point(t: string, ok: boolean, ms = 200, reason: UptimeRecord['reason'] = null): UptimeRecord {
  return { t, ok, status: ok ? 200 : null, ms, reason };
}

/* ---------------- snapshots ---------------- */

test('a snapshot keeps what a report needs and nothing else', () => {
  const snap = snapshotOf(result());
  assert.equal(snap.at, '2026-08-20T03:00:00.000Z');
  assert.equal(snap.status, 503);
  assert.equal(snap.peer, '10.0.0.1');
  assert.equal(snap.server, 'nginx');
  assert.equal(snap.contentType, 'text/html');
  assert.equal(snap.bodySize, 512);
  assert.equal(snap.bodyExcerpt, '502 Bad Gateway');
  assert.equal(snap.reason, 'status');
});

test('a check that never got a response still yields a usable snapshot', () => {
  // A timeout is the commonest outage and the one with the least evidence, so
  // every field has to degrade to null rather than throwing.
  const snap = snapshotOf(result({ status: null, reason: 'timeout', detail: null }));
  assert.equal(snap.status, null);
  assert.equal(snap.peer, null);
  assert.equal(snap.server, null);
  assert.equal(snap.bodySize, null);
  assert.equal(snap.reason, 'timeout');
  assert.equal(snap.at, '2026-08-20T03:00:00.000Z', 'the time it happened is always known');
});

/* ---------------- where the trouble began ---------------- */

test('the run is walked back past the confirming check', () => {
  // failureThreshold 3: the outage began two checks before it was called.
  const history = [
    point('t1', true),
    point('t2', true),
    point('t3', false),
    point('t4', false),
    point('t5', false),
  ];
  const run = failureRunOf(history, 't5');
  assert.equal(run.firstFailureAt, 't3');
  assert.equal(run.failureChecks, 3);
  assert.deepEqual(run.precursor.map((p) => p.t), ['t1', 't2']);
});

test('a disputed check neither extends the run nor ends it', () => {
  // It did not count as a failure, so it cannot lengthen the outage; it was not
  // healthy either, so it cannot mark the start.
  const history = [
    point('t1', true),
    point('t2', false, 9000, 'disputed'),
    point('t3', false),
    point('t4', false),
  ];
  const run = failureRunOf(history, 't4');
  assert.equal(run.firstFailureAt, 't3');
  assert.equal(run.failureChecks, 2);
  assert.deepEqual(run.precursor.map((p) => p.t), ['t1', 't2']);
});

test('a confirming check that is not in the history yet counts as one failure', () => {
  const run = failureRunOf([point('t1', true)], 'later');
  assert.equal(run.failureChecks, 1);
  assert.equal(run.firstFailureAt, 'later');
});

test('an empty history degrades rather than throwing', () => {
  const run = failureRunOf([], 'now');
  assert.equal(run.failureChecks, 1);
  assert.equal(run.firstFailureAt, 'now');
  assert.deepEqual(run.precursor, []);
  assert.doesNotThrow(() => failureRunOf(undefined as unknown as UptimeRecord[], 'now'));
});

test('the precursor is bounded, so a long healthy run does not bloat the report', () => {
  const history = [
    ...Array.from({ length: 40 }, (_, i) => point(`ok${i}`, true, 100 + i)),
    point('bad', false),
  ];
  const run = failureRunOf(history, 'bad');
  assert.equal(run.precursor.length, PRECURSOR_POINTS);
  assert.equal(run.precursor.at(-1)?.t, 'ok39', 'the checks closest to the failure are the ones kept');
});

test('the precursor carries the latencies, which is the point of it', () => {
  // A site that crept from 200ms to 1.9s before falling over failed differently
  // from one that died instantly, and only these numbers say which happened.
  const history = [point('a', true, 210), point('b', true, 900), point('c', true, 1900), point('d', false)];
  const run = failureRunOf(history, 'd');
  assert.deepEqual(run.precursor.map((p) => p.ms), [210, 900, 1900]);
});

/* ---------------- what changed on recovery ---------------- */

function snap(over: Partial<IncidentSnapshot> = {}): IncidentSnapshot {
  return { ...snapshotOf(result()), ...over };
}

test('an address that changed is reported, because no status code would say it', () => {
  const changes = diffSnapshots(snap({ peer: '10.0.0.1' }), snap({ peer: '10.0.0.9' }));
  assert.deepEqual(changes, [{ field: 'peer', from: '10.0.0.1', to: '10.0.0.9' }]);
});

test('the symptom fields are deliberately not diffed', () => {
  // "It was failing and now it is not" is the definition of a recovery, not a
  // finding. Only fields that might explain it belong here.
  const changes = diffSnapshots(
    snap({ status: 503, responseTimeMs: 9000, reason: 'status', message: 'boom' }),
    snap({ status: 200, responseTimeMs: 190, reason: null, message: null }),
  );
  assert.deepEqual(changes, []);
});

test('a page appearing or vanishing is always worth saying', () => {
  assert.deepEqual(
    diffSnapshots(snap({ bodySize: 0 }), snap({ bodySize: 84_000 })),
    [{ field: 'bodySize', from: '0', to: '84000' }],
  );
  assert.deepEqual(
    diffSnapshots(snap({ bodySize: null }), snap({ bodySize: 84_000 })),
    [{ field: 'bodySize', from: null, to: '84000' }],
  );
});

test('ordinary page-size jitter is not reported as a change', () => {
  assert.deepEqual(diffSnapshots(snap({ bodySize: 84_000 }), snap({ bodySize: 84_120 })), []);
  assert.equal(
    diffSnapshots(snap({ bodySize: 512 }), snap({ bodySize: 84_000 })).length,
    1,
    'a real collapse still shows',
  );
});

test('a renewed certificate is visible through the fingerprint', () => {
  // Every other certificate field can be identical across a renewal.
  const changes = diffSnapshots(
    snap({ certFingerprint: 'AA:BB', certIssuer: "Let's Encrypt" }),
    snap({ certFingerprint: 'CC:DD', certIssuer: "Let's Encrypt" }),
  );
  assert.deepEqual(changes, [{ field: 'certFingerprint', from: 'AA:BB', to: 'CC:DD' }]);
});

test('nothing observably different is reported as exactly that', () => {
  assert.deepEqual(diffSnapshots(snap(), snap()), [], 'an empty list, not a fabricated cause');
});

/* ---------------- opening and closing ---------------- */

test('the detection delay is stated rather than hidden', () => {
  const history = [
    point('2026-08-20T02:30:00.000Z', true),
    point('2026-08-20T02:45:00.000Z', false),
    point('2026-08-20T03:00:00.000Z', false),
  ];
  const report = openReport({
    targetId: 'api',
    confirmedAt: '2026-08-20T03:00:00.000Z',
    result: result(),
    history,
    vantage: 'confirmed-failed',
  });

  assert.equal(report.firstFailureAt, '2026-08-20T02:45:00.000Z');
  assert.equal(report.detectionMs, 15 * 60_000, 'the price of failureThreshold, in milliseconds');
  assert.equal(report.failureChecks, 2);
  assert.equal(report.vantage, 'confirmed-failed');
  assert.equal(report.recovery, null);
  assert.equal(report.recoveredAt, null);
  assert.equal(report.alerts, null, 'not known until the fan-out has run');
  assert.equal(report.id, report.confirmedAt);
});

test('closing records the recovery, the duration and the differences', () => {
  const opened = openReport({
    targetId: 'api',
    confirmedAt: '2026-08-20T03:00:00.000Z',
    result: result(),
    history: [point('2026-08-20T03:00:00.000Z', false)],
  });

  const closed = closeReport(opened, {
    recoveredAt: '2026-08-20T03:30:00.000Z',
    result: result({
      ok: true,
      status: 200,
      reason: null,
      message: null,
      checkedAt: '2026-08-20T03:30:00.000Z',
      detail: {
        headers: { server: 'nginx', 'content-type': 'text/html' },
        tls: null,
        chain: [],
        peer: '10.0.0.9',
        bodySize: 84_000,
        bodyExcerpt: null,
      },
    }),
    history: [point('2026-08-20T03:30:00.000Z', true)],
  });

  assert.equal(closed.durationMs, 30 * 60_000);
  assert.equal(closed.recovery?.status, 200);
  assert.deepEqual(
    closed.changed.map((change) => change.field).sort(),
    ['bodySize', 'peer'],
    'the address moved and the page came back — evidence, not a conclusion',
  );
});

test('the first check that passed is reported, not just the confirmed recovery', () => {
  // With recoveryThreshold above one the site was already working before
  // StatusDog was willing to say so, and the report should not overstate the outage.
  const history = [
    point('2026-08-20T03:00:00.000Z', false),
    point('2026-08-20T03:15:00.000Z', true),
    point('2026-08-20T03:30:00.000Z', true),
  ];
  const closed = closeReport(
    openReport({
      targetId: 'api',
      confirmedAt: '2026-08-20T03:00:00.000Z',
      result: result(),
      history: [point('2026-08-20T03:00:00.000Z', false)],
    }),
    { recoveredAt: '2026-08-20T03:30:00.000Z', result: result({ ok: true }), history },
  );
  assert.equal(closed.firstSuccessAt, '2026-08-20T03:15:00.000Z');
});

/* ---------------- the log ---------------- */

const openOptions = {
  targetId: 'api',
  confirmedAt: '2026-08-20T03:00:00.000Z',
  result: result(),
  history: [point('2026-08-20T03:00:00.000Z', false)],
};

test('a second down without an intervening up does not start a duplicate', () => {
  const once = openInLog(emptyLog('api'), openOptions);
  const twice = openInLog(once, { ...openOptions, confirmedAt: '2026-08-20T03:15:00.000Z' });
  assert.equal(twice.reports.length, 1);
  assert.equal(openReportOf(twice)?.confirmedAt, '2026-08-20T03:00:00.000Z');
});

test('closing touches the open report and leaves finished ones alone', () => {
  let log = openInLog(emptyLog('api'), openOptions);
  log = closeInLog(log, {
    recoveredAt: '2026-08-20T03:30:00.000Z',
    result: result({ ok: true }),
    history: [],
  });
  assert.equal(openReportOf(log), null);

  const first = log.reports[0]!;
  log = openInLog(log, { ...openOptions, confirmedAt: '2026-08-21T01:00:00.000Z' });
  log = closeInLog(log, {
    recoveredAt: '2026-08-21T01:30:00.000Z',
    result: result({ ok: true }),
    history: [],
  });

  assert.equal(log.reports.length, 2);
  assert.deepEqual(log.reports[0], first, 'the earlier report is untouched');
});

test('closing with nothing open is a no-op rather than an error', () => {
  const log = emptyLog('api');
  assert.deepEqual(
    closeInLog(log, { recoveredAt: 'now', result: result({ ok: true }), history: [] }),
    log,
  );
});

test('the log is bounded, keeping the most recent reports', () => {
  let log = emptyLog('api');
  for (let i = 0; i < REPORT_LIMIT + 5; i++) {
    const at = `2026-08-20T${String(i % 24).padStart(2, '0')}:00:00.${String(i).padStart(3, '0')}Z`;
    log = openInLog(log, { ...openOptions, confirmedAt: at });
    log = closeInLog(log, { recoveredAt: at, result: result({ ok: true }), history: [] });
  }
  assert.equal(log.reports.length, REPORT_LIMIT);
});

test('alert results are attached to the report they belong to', () => {
  let log = openInLog(emptyLog('api'), openOptions);
  log = attachAlerts(log, openOptions.confirmedAt, { attempted: 2, delivered: 1, failed: 1 });
  assert.deepEqual(log.reports[0]!.alerts, { attempted: 2, delivered: 1, failed: 1 });

  // An unknown id must not corrupt the log.
  assert.deepEqual(attachAlerts(log, 'nope', { attempted: 9, delivered: 9, failed: 0 }), log);
});

/* ---------------- the excerpt ---------------- */

test('an error page is reduced to the sentence a human would have read', () => {
  const html = `
    <html><head><style>body{color:red}</style><script>var x=1</script></head>
    <body><h1>502 Bad Gateway</h1>
    <p>The&nbsp;upstream server did not respond.</p></body></html>`;
  assert.equal(excerptOf(html), '502 Bad Gateway The upstream server did not respond.');
});

test('the excerpt is capped and marked as cut', () => {
  const excerpt = excerptOf('x'.repeat(1000), 50);
  assert.equal(excerpt?.length, 51, '50 characters plus the ellipsis');
  assert.ok(excerpt?.endsWith('…'));
});

test('a page with no text at all yields null, not an empty string', () => {
  assert.equal(excerptOf('<html><body><img src="x"></body></html>'), null);
  assert.equal(excerptOf('   '), null);
  assert.equal(excerptOf(''), null);
});

/* ---------------- end to end through the probe ---------------- */

const server = await startTestServer((req, res) => {
  if ((req.url ?? '/').startsWith('/broken')) {
    res.writeHead(503, { 'content-type': 'text/html', server: 'test-origin' });
    res.end('<h1>503 Service Temporarily Unavailable</h1><p>upstream is down</p>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html', server: 'test-origin' });
  res.end(`<h1>fine</h1>${'.'.repeat(2000)}`);
});

after(() => server.close());

test('the probe records who answered and how much they sent', async () => {
  const healthy = await probeUrl(`${server.url}/`);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.detail?.peer, '127.0.0.1', 'the address that actually answered');
  assert.ok((healthy.detail?.bodySize ?? 0) > 2000);
  assert.equal(healthy.detail?.bodyExcerpt, null, 'a healthy page is not worth storing');
});

test('an authenticated check keeps no excerpt, because the report is public', async () => {
  // The status, the curated headers and the size are still kept; only the page
  // content is withheld, because a response behind a credential is not something
  // every visitor could have seen.
  const authed = await probeUrl(`${server.url}/broken`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(authed.ok, false);
  assert.equal(authed.status, 503);
  assert.equal(authed.detail?.bodyExcerpt, null);
  assert.ok((authed.detail?.bodySize ?? 0) > 0, 'the size is not sensitive');
  assert.equal(authed.detail?.peer, '127.0.0.1');
});

test('a failing response keeps an excerpt, and the snapshot can read it', async () => {
  const failed = await probeUrl(`${server.url}/broken`);
  assert.equal(failed.ok, false);
  assert.match(failed.detail?.bodyExcerpt ?? '', /503 Service Temporarily Unavailable/);

  const snapshot = snapshotOf(failed);
  assert.equal(snapshot.status, 503);
  assert.equal(snapshot.server, 'test-origin');
  assert.equal(snapshot.peer, '127.0.0.1');
  assert.match(snapshot.bodyExcerpt ?? '', /upstream is down/);
});
