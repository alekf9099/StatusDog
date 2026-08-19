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
 */
import { probe } from '../../dist/monitor/probe.js';
import { resolveRoster } from '../../dist/store/roster.js';
import { applyCheck } from '../../dist/store/uptime.js';
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
  try {
    targets = resolveRoster(ROSTER);
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }

  const startedAt = Date.now();
  const transitions = [];
  const alerts = [];

  const checks = await Promise.all(targets.map(async (target) => {
    const result = await probe(target);
    const base = {
      id: target.id,
      ok: result.ok,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
    };

    try {
      const { entry, transitioned, previousState, cert } = await applyCheck(kv, target, result);
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

      return {
        ...base,
        state: entry.state,
        transitioned,
        stored: true,
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
