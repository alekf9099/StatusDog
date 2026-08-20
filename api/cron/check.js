/**
 * `POST /api/cron/check` — probe every roster target, persist the results, and
 * alert on confirmed up/down transitions.
 *
 * This is the 24/7 half of StatusDog: something has to call it on a schedule.
 * Two ways, both configured in the repo:
 *
 *   - GitHub Actions (.github/workflows/monitor.yml) — every 15 minutes, free,
 *     and the default here because Vercel's Hobby plan caps cron at once a day.
 *   - Vercel Cron — add a `crons` entry to vercel.json on a Pro plan. Vercel
 *     sends `Authorization: Bearer $CRON_SECRET`, which this accepts as-is.
 *
 * Environment:
 *   CRON_SECRET                shared secret; unset closes the route
 *   KV_REST_API_URL / _TOKEN   (or the Upstash equivalents) for storage
 *   STATUSDOG_WEBHOOK_URL      optional; comma-separated alert webhooks
 *   STATUSDOG_WEBHOOK_ON       optional; `down`, `up`, or `down,up`
 *   STATUSDOG_WEBHOOK_FORMAT   optional; `full` or `text`
 *
 * Besides up/down changes it also warns before a TLS certificate expires — the
 * one total outage that is entirely foreseeable. Each threshold fires once per
 * certificate, and renewing resets them.
 *
 * The request body may carry a second opinion from another network:
 *
 *   { "vantage": { "name": "github-actions",
 *                  "checks": [ { "id": "copykiller", "reachable": true, "status": 200 } ] } }
 *
 * When the primary fails and that vantage did not, the check is inconclusive —
 * stored, but kept out of the state machine and the statistics, and nobody is paged.
 * One observer cannot tell a broken site from a broken path to it.
 */
import { probe } from '../../dist/monitor/probe.js';
import { resolveRoster } from '../../dist/store/roster.js';
import { applyCheck, readEntry } from '../../dist/store/uptime.js';
import { recordCheck } from '../../dist/store/stats-store.js';
import { kvEnvNames, kvFromEnv } from '../../dist/store/kv.js';
import {
  describeStaleness,
  evaluateStaleness,
  readSchedulerState,
  recordRun,
  wasReportedStale,
  writeSchedulerState,
} from '../../dist/store/scheduler.js';
import { dispatchAlerts, dispatchTransitions, notifiersFromEnv } from '../../dist/notify/dispatch.js';
import { certSeverity, describeCertExpiry } from '../../dist/monitor/cert.js';
import { findVantageReport, nextDisputeCount, reconcile } from '../../dist/monitor/vantage.js';
import { ROSTER } from '../../dist/roster.data.js';

/** Constant-time comparison so the secret cannot be probed byte by byte. */
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function presentedSecret(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const header = req.headers?.['x-cron-secret'];
  return typeof header === 'string' ? header : null;
}

/**
 * Read the JSON body, if there is one.
 *
 * Vercel parses it for us; the local dev server does not, so both paths are
 * handled. A malformed body is ignored rather than failing the run — a second
 * opinion is an improvement on the primary check, never a prerequisite for it.
 */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body !== '') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return null;
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({
      error: 'CRON_SECRET is not set, so scheduled checks are disabled.',
      hint: 'Set CRON_SECRET in the deployment environment and in the scheduler.',
    });
    return;
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({
      error: 'No key-value store is configured, so results cannot be persisted.',
      hint: `Set one of these credential pairs: ${kvEnvNames().join(', ')}`,
    });
    return;
  }

  let targets;
  let offsetMinutes = 0;
  try {
    targets = resolveRoster(ROSTER);
    offsetMinutes = Number(ROSTER?.stats?.timezoneOffsetMinutes) || 0;
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  const body = await readBody(req);
  const vantage = body && typeof body.vantage === 'object' ? body.vantage : null;

  const startedAt = Date.now();
  const transitions = [];
  const alerts = [];
  const disputes = [];

  const checks = await Promise.all(targets.map(async (target) => {
    const result = await probe(target);
    const base = {
      id: target.id,
      ok: result.ok,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
    };

    try {
      // Captured before applyCheck overwrites them: the rollup needs to know how
      // long the target had been in its previous state to attribute downtime.
      const before = await readEntry(kv, target);

      // Does another network agree? Only a failure the second vantage will not
      // corroborate is suppressed, and only for a limited run of checks.
      const verdict = reconcile({
        primaryOk: result.ok,
        report: findVantageReport(vantage, target.id),
        expectStatus: target.expectStatus,
        reason: result.reason,
        consecutiveDisputes: before.consecutiveDisputes,
        vantageName: vantage?.name,
      });

      const { entry, transitioned, previousState, cert } = await applyCheck(kv, target, result, {
        inconclusive: !verdict.conclusive,
        disputeRun: nextDisputeCount(before.consecutiveDisputes, verdict.outcome),
      });

      if (verdict.outcome === 'disputed' || verdict.outcome === 'dispute-exhausted') {
        disputes.push({ id: target.id, outcome: verdict.outcome, note: verdict.note });
      }
      if (transitioned) {
        transitions.push({
          target,
          from: previousState,
          to: entry.state,
          result,
          at: result.checkedAt,
        });
      }

      if (cert.crossed !== null) {
        alerts.push({
          kind: 'cert-expiry',
          severity: certSeverity(cert),
          summary: describeCertExpiry(target, cert),
          target: { id: target.id, name: target.name, url: target.url },
          at: result.checkedAt,
          data: {
            daysRemaining: cert.daysRemaining,
            threshold: cert.crossed,
            expired: cert.expired,
            validTo: cert.state.validTo,
          },
        });
      }

      // Rollups are a separate key, so a failure here loses a data point rather
      // than the check itself. An inconclusive check is skipped entirely: a result
      // nobody can interpret must not move the uptime figure either way.
      let rolled = false;
      if (verdict.conclusive) {
        try {
          await recordCheck(kv, target, result, {
            offsetMinutes,
            previousState: before.state,
            previousCheckedAt: before.lastResult?.checkedAt ?? null,
            transitionedTo: transitioned ? entry.state : null,
          });
          rolled = true;
        } catch {
          rolled = false;
        }
      }

      return {
        ...base,
        state: entry.state,
        transitioned,
        stored: true,
        rolled,
        vantage: verdict.outcome,
        conclusive: verdict.conclusive,
        certDaysRemaining: cert.daysRemaining,
      };
    } catch (err) {
      // A storage failure must not hide the check itself.
      return { ...base, stored: false, storeError: err.message };
    }
  }));

  const unstored = checks.filter((check) => !check.stored);
  const everythingFailed = checks.length > 0 && unstored.length === checks.length;
  const down = checks.filter((check) => !check.ok).length;

  // Stamp the run so the heartbeat and the UI can tell whether checks are still
  // arriving. Only on a run that actually stored something — a run that could not
  // reach the store has not really happened.
  //
  // This has to come *before* the fan-out below, because it can produce an alert
  // of its own and the fan-out only sends what is in the array when it runs.
  let scheduler = null;
  if (!everythingFailed) {
    try {
      const previous = await readSchedulerState(kv);

      // Only a run can tell that checks have resumed, so this is where the
      // all-clear comes from — the heartbeat is daily and would be far too slow.
      if (wasReportedStale(previous)) {
        const staleness = evaluateStaleness(previous, startedAt);
        alerts.push({
          kind: 'monitor-stale',
          severity: 'info',
          summary: describeStaleness(staleness, 'recovered'),
          target: null,
          at: new Date(startedAt).toISOString(),
          data: { state: 'recovered', wasSilentForMs: staleness.sinceMs },
        });
      }

      scheduler = recordRun(previous, new Date(startedAt).toISOString(), checks.length, down);
      await writeSchedulerState(kv, scheduler);
    } catch (err) {
      // The checks themselves are already saved; losing the stamp is survivable.
      scheduler = { error: err.message };
    }
  }

  // Alerting comes last and never fails the run: a dead webhook is not an
  // outage, and the check results are already safely persisted by this point.
  const notifiers = notifiersFromEnv();
  const [transitionResults, alertResults] = await Promise.all([
    dispatchTransitions(notifiers, transitions),
    dispatchAlerts(notifiers, alerts),
  ]);
  const attempted = transitionResults.attempted + alertResults.attempted;
  const delivered = transitionResults.delivered + alertResults.delivered;
  const failed = transitionResults.failed + alertResults.failed;
  const outcomes = [...transitionResults.outcomes, ...alertResults.outcomes];

  res.status(everythingFailed ? 502 : 200).json({
    checkedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    targets: checks.length,
    down,
    scheduler,
    transitions: transitions.map((event) => `${event.target.id}:${event.from}->${event.to}`),
    vantage: vantage ? { name: vantage.name ?? 'unnamed', reports: vantage.checks?.length ?? 0 } : null,
    disputes,
    // `alerts` now holds more than one kind, and a scheduler alert has no target.
    certWarnings: alerts
      .filter((alert) => alert.kind === 'cert-expiry')
      .map((alert) => `${alert.target.id}:${alert.data.daysRemaining}d`),
    schedulerAlerts: alerts
      .filter((alert) => alert.kind === 'monitor-stale')
      .map((alert) => alert.data.state),
    alerts: { notifiers: notifiers.length, attempted, delivered, failed, outcomes },
    checks,
  });
}
