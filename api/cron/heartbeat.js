/**
 * `GET|POST /api/cron/heartbeat` — asks whether the scheduler is still alive.
 *
 * This is the one job that must not depend on GitHub Actions, because GitHub
 * Actions is what it is watching. So it runs on Vercel Cron instead — once a day,
 * which is all the Hobby plan allows and all this needs. A dead scheduler found
 * within a day beats one never found at all, and the office shows a banner the
 * moment anyone looks.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` by itself, so the same
 * gate as the check endpoint applies with no extra configuration.
 */
import { kvEnvNames, kvFromEnv } from '../../dist/store/kv.js';
import {
  DEFAULT_STALE_AFTER_MS,
  describeStaleness,
  evaluateStaleness,
  readSchedulerState,
  stalenessAlertKind,
  writeSchedulerState,
} from '../../dist/store/scheduler.js';
import { dispatchAlerts, notifiersFromEnv } from '../../dist/notify/dispatch.js';
import { parseIntParam } from '../../dist/util/params.js';

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
    res.status(503).json({ error: 'CRON_SECRET is not set, so the heartbeat is disabled.' });
    return;
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({
      error: 'No key-value store is configured, so there is no run history to check.',
      hint: `Set one of these credential pairs: ${kvEnvNames().join(', ')}`,
    });
    return;
  }

  const staleAfterMs = parseIntParam(process.env.STATUSDOG_STALE_AFTER_MINUTES, {
    min: 5,
    max: 24 * 60,
    fallback: DEFAULT_STALE_AFTER_MS / 60_000,
  }) * 60_000;

  const state = await readSchedulerState(kv);
  const staleness = evaluateStaleness(state, Date.now(), staleAfterMs);
  const kind = stalenessAlertKind(state, staleness);

  let alerts = { notifiers: 0, attempted: 0, delivered: 0, failed: 0, outcomes: [] };

  if (kind) {
    const notifiers = notifiersFromEnv();
    const summary = describeStaleness(staleness, kind);
    const { attempted, delivered, failed, outcomes } = await dispatchAlerts(notifiers, [{
      kind: 'monitor-stale',
      severity: kind === 'stale' ? 'critical' : 'info',
      summary,
      target: null,
      at: new Date().toISOString(),
      data: {
        state: kind,
        lastRunAt: staleness.lastRunAt,
        sinceMs: staleness.sinceMs,
        missedRuns: staleness.missedRuns,
        staleAfterMs: staleness.staleAfterMs,
      },
    }]);
    alerts = { notifiers: notifiers.length, attempted, delivered, failed, outcomes };

    // Record that the episode has been reported, so a daily heartbeat does not
    // repeat itself for a week. Cleared by the next successful check run.
    await writeSchedulerState(kv, {
      ...state,
      staleNotifiedAt: kind === 'stale' ? new Date().toISOString() : null,
    });
  }

  res.status(200).json({
    checkedAt: new Date().toISOString(),
    scheduler: staleness,
    alerted: kind,
    alerts,
  });
}
