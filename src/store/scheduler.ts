import type { KvClient } from './kv.js';

/**
 * The dead man's switch.
 *
 * Everything else in StatusDog notices when a *site* goes quiet. Nothing noticed
 * when the *scheduler* did — and that is the worse failure, because silence looks
 * exactly like health. A revoked token, an exhausted Actions quota or a disabled
 * workflow would have left the dashboard showing green numbers from last Tuesday.
 *
 * So every run stamps its time here, and two independent things watch the stamp:
 * a daily Vercel cron (which does not depend on GitHub Actions being alive), and
 * the UI, which shows a banner the moment anyone looks at a stale office.
 */

const KEY = 'statusdog:v1:scheduler';

/** Three missed runs at the 15-minute cadence. */
export const DEFAULT_STALE_AFTER_MS = 45 * 60_000;

export interface SchedulerState {
  lastRunAt: string | null;
  lastRunTargets: number;
  lastRunDown: number;
  /** Total successful runs recorded, purely so the health endpoint has something to show. */
  runs: number;
  /** Set while a staleness alert is outstanding, so it is sent once per episode. */
  staleNotifiedAt: string | null;
}

export const EMPTY_SCHEDULER_STATE: SchedulerState = {
  lastRunAt: null,
  lastRunTargets: 0,
  lastRunDown: 0,
  runs: 0,
  staleNotifiedAt: null,
};

export interface Staleness {
  /** `false` while checks are arriving on time. */
  stale: boolean;
  /** How long since the last run, or `null` if there has never been one. */
  sinceMs: number | null;
  lastRunAt: string | null;
  staleAfterMs: number;
  /** How many runs appear to have been missed, for the message. */
  missedRuns: number;
}

export async function readSchedulerState(kv: KvClient): Promise<SchedulerState> {
  const raw = await kv.get(KEY);
  if (raw === null) return { ...EMPTY_SCHEDULER_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<SchedulerState>;
    return { ...EMPTY_SCHEDULER_STATE, ...parsed };
  } catch {
    return { ...EMPTY_SCHEDULER_STATE };
  }
}

export async function writeSchedulerState(kv: KvClient, state: SchedulerState): Promise<void> {
  await kv.set(KEY, JSON.stringify(state));
}

/**
 * Was the scheduler in a reported-stale state before this run?
 *
 * The two watchers have complementary blind spots, so they split the work: only
 * the heartbeat can notice that runs have *stopped*, and only a run can notice
 * that they have *resumed*. This is what a run checks before stamping.
 */
export function wasReportedStale(previous: SchedulerState): boolean {
  return Boolean(previous.staleNotifiedAt);
}

/**
 * Stamp a completed run.
 *
 * Clears the outstanding staleness alert — the caller should announce the
 * recovery first, using {@link wasReportedStale}, because after this the evidence
 * is gone.
 */
export function recordRun(
  previous: SchedulerState,
  at: string,
  targets: number,
  down: number,
): SchedulerState {
  return {
    lastRunAt: at,
    lastRunTargets: targets,
    lastRunDown: down,
    runs: (previous.runs ?? 0) + 1,
    staleNotifiedAt: null,
  };
}

export function evaluateStaleness(
  state: SchedulerState,
  nowMs: number,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
  expectedIntervalMs = 15 * 60_000,
): Staleness {
  const lastRunAt = state.lastRunAt ?? null;
  const lastMs = lastRunAt ? Date.parse(lastRunAt) : NaN;

  // Never run at all. That is not "stale" — nothing has been promised yet, and
  // alerting on a fresh deployment that has not been wired up is just noise.
  if (!Number.isFinite(lastMs)) {
    return { stale: false, sinceMs: null, lastRunAt, staleAfterMs, missedRuns: 0 };
  }

  const sinceMs = Math.max(0, nowMs - lastMs);
  return {
    stale: sinceMs > staleAfterMs,
    sinceMs,
    lastRunAt,
    staleAfterMs,
    missedRuns: Math.max(0, Math.floor(sinceMs / expectedIntervalMs) - 1),
  };
}

/** Alert once when it goes stale, and once more when it comes back. */
export function stalenessAlertKind(
  state: SchedulerState,
  staleness: Staleness,
): 'stale' | 'recovered' | null {
  if (staleness.stale && !state.staleNotifiedAt) return 'stale';
  if (!staleness.stale && state.staleNotifiedAt) return 'recovered';
  return null;
}

export function describeStaleness(staleness: Staleness, kind: 'stale' | 'recovered'): string {
  const minutes = Math.round((staleness.sinceMs ?? 0) / 60_000);
  if (kind === 'recovered') {
    return 'StatusDog scheduled checks are running again.';
  }
  return (
    `StatusDog has not run a check for ${minutes} minute(s)` +
    (staleness.missedRuns > 0 ? ` — about ${staleness.missedRuns} missed run(s)` : '') +
    '. Nothing is being monitored until this is fixed.'
  );
}
