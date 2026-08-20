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
 *
 * The threshold is **measured, not assumed.** The workflow asks GitHub for a run
 * every fifteen minutes; over 28 observed runs GitHub actually delivered one every
 * 32 minutes on median, with gaps up to 58. A fixed 45-minute threshold therefore
 * fired on a perfectly healthy scheduler — the same class of mistake as alerting on
 * transpacific latency instead of on the site. So the interval is derived from the
 * gaps this deployment actually sees, and the threshold follows it.
 */

const KEY = 'statusdog:v1:scheduler';

/** Gaps kept for the median. Enough to ride out one bad afternoon. */
export const GAP_SAMPLE_SIZE = 20;
/** Below this many samples there is nothing to take a median of. */
const MIN_GAP_SAMPLES = 4;

/** Used only until enough real gaps have been observed. */
export const FALLBACK_INTERVAL_MS = 30 * 60_000;
/** How many missed intervals count as stopped rather than late. */
export const STALE_INTERVAL_MULTIPLIER = 3;
/** Floor and ceiling, so a freak sample cannot make the switch useless either way. */
export const MIN_STALE_AFTER_MS = 30 * 60_000;
export const MAX_STALE_AFTER_MS = 6 * 3_600_000;

/** A gap longer than this is an outage in the scheduler, not evidence of its cadence. */
const MAX_CREDIBLE_GAP_MS = 4 * 3_600_000;

export interface SchedulerState {
  lastRunAt: string | null;
  lastRunTargets: number;
  lastRunDown: number;
  /** Total successful runs recorded, purely so the health endpoint has something to show. */
  runs: number;
  /** Set while a staleness alert is outstanding, so it is sent once per episode. */
  staleNotifiedAt: string | null;
  /** Recent intervals between runs, newest last. The cadence is learned from these. */
  recentGapsMs: number[];
}

export const EMPTY_SCHEDULER_STATE: SchedulerState = {
  lastRunAt: null,
  lastRunTargets: 0,
  lastRunDown: 0,
  runs: 0,
  staleNotifiedAt: null,
  recentGapsMs: [],
};

export interface Staleness {
  /** `false` while checks are arriving at the cadence this deployment actually sees. */
  stale: boolean;
  /** How long since the last run, or `null` if there has never been one. */
  sinceMs: number | null;
  lastRunAt: string | null;
  staleAfterMs: number;
  /** The cadence used to judge, and whether it was measured or assumed. */
  intervalMs: number;
  intervalSource: 'observed' | 'fallback' | 'configured';
  /** How many runs appear to have been missed, at the interval above. */
  missedRuns: number;
}

export async function readSchedulerState(kv: KvClient): Promise<SchedulerState> {
  const raw = await kv.get(KEY);
  if (raw === null) return { ...EMPTY_SCHEDULER_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<SchedulerState>;
    return {
      ...EMPTY_SCHEDULER_STATE,
      ...parsed,
      // Absent on state written before the cadence was learned.
      recentGapsMs: sanitizeGaps(parsed.recentGapsMs),
    };
  } catch {
    return { ...EMPTY_SCHEDULER_STATE };
  }
}

export async function writeSchedulerState(kv: KvClient, state: SchedulerState): Promise<void> {
  await kv.set(KEY, JSON.stringify(state));
}

function sanitizeGaps(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((gap): gap is number => typeof gap === 'number' && Number.isFinite(gap) && gap > 0)
    .slice(-GAP_SAMPLE_SIZE);
}

/**
 * The cadence this deployment actually runs at, or `null` before there is enough
 * evidence.
 *
 * Median rather than mean: one four-hour outage should not double the estimate and
 * blind the switch for the rest of the day.
 */
export function observedIntervalMs(state: SchedulerState): number | null {
  const samples = sanitizeGaps(state.recentGapsMs)
    // A gap this long was the scheduler being broken, which says nothing about how
    // often it runs when it works.
    .filter((gap) => gap <= MAX_CREDIBLE_GAP_MS)
    .sort((a, b) => a - b);

  if (samples.length < MIN_GAP_SAMPLES) return null;

  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 === 0
    ? Math.round((samples[middle - 1]! + samples[middle]!) / 2)
    : samples[middle]!;
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
 * Stamp a completed run, and record the gap since the last one.
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
  const previousMs = previous.lastRunAt ? Date.parse(previous.lastRunAt) : NaN;
  const currentMs = Date.parse(at);
  const gap = Number.isFinite(previousMs) && Number.isFinite(currentMs)
    ? currentMs - previousMs
    : NaN;

  const gaps = sanitizeGaps(previous.recentGapsMs);
  // Ignore a non-positive gap: two runs landing in the same instant, or a clock
  // that went backwards, tell us nothing about cadence.
  if (Number.isFinite(gap) && gap > 0) gaps.push(gap);

  return {
    lastRunAt: at,
    lastRunTargets: targets,
    lastRunDown: down,
    runs: (previous.runs ?? 0) + 1,
    staleNotifiedAt: null,
    recentGapsMs: gaps.slice(-GAP_SAMPLE_SIZE),
  };
}

export interface StalenessOptions {
  /**
   * An explicit threshold in ms. Wins over the measured cadence, for a deployment
   * that knows better than the heuristic.
   */
  staleAfterMs?: number | null;
}

export function evaluateStaleness(
  state: SchedulerState,
  nowMs: number,
  options: StalenessOptions | number = {},
): Staleness {
  // Callers used to pass a bare threshold; keep that working.
  const opts: StalenessOptions = typeof options === 'number' ? { staleAfterMs: options } : options;

  const observed = observedIntervalMs(state);
  const intervalMs = observed ?? FALLBACK_INTERVAL_MS;
  const intervalSource: Staleness['intervalSource'] = opts.staleAfterMs
    ? 'configured'
    : observed !== null
      ? 'observed'
      : 'fallback';

  const staleAfterMs = opts.staleAfterMs
    ? opts.staleAfterMs
    : Math.min(MAX_STALE_AFTER_MS, Math.max(MIN_STALE_AFTER_MS, intervalMs * STALE_INTERVAL_MULTIPLIER));

  const lastRunAt = state.lastRunAt ?? null;
  const lastMs = lastRunAt ? Date.parse(lastRunAt) : NaN;

  // Never run at all. That is not "stale" — nothing has been promised yet, and
  // alerting on a fresh deployment that has not been wired up is just noise.
  if (!Number.isFinite(lastMs)) {
    return {
      stale: false,
      sinceMs: null,
      lastRunAt,
      staleAfterMs,
      intervalMs,
      intervalSource,
      missedRuns: 0,
    };
  }

  const sinceMs = Math.max(0, nowMs - lastMs);
  return {
    stale: sinceMs > staleAfterMs,
    sinceMs,
    lastRunAt,
    staleAfterMs,
    intervalMs,
    intervalSource,
    missedRuns: Math.max(0, Math.floor(sinceMs / intervalMs) - 1),
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
  if (kind === 'recovered') {
    return 'StatusDog scheduled checks are running again.';
  }

  const minutes = Math.round((staleness.sinceMs ?? 0) / 60_000);
  const cadence = Math.round(staleness.intervalMs / 60_000);
  return (
    `StatusDog has not run a check for ${minutes} minute(s)` +
    (staleness.missedRuns > 0 ? ` — about ${staleness.missedRuns} missed run(s)` : '') +
    `. It normally runs every ${cadence} minute(s). Nothing is being monitored until this is fixed.`
  );
}
