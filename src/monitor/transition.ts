import type { ProbeResult } from '../config/types.js';

export type TargetState = 'up' | 'down' | 'unknown';

/** Everything needed to decide the next state, and nothing else. */
export interface StateSnapshot {
  state: TargetState;
  /** When the target entered its current state. */
  since: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface Thresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

export const INITIAL_STATE: StateSnapshot = {
  state: 'unknown',
  since: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
};

/**
 * Fold a probe result into a target's state.
 *
 * Pure, so the long-running engine and the serverless cron job cannot drift
 * apart on the one rule that actually matters: a target flips only after
 * `failureThreshold` consecutive failures (or `recoveryThreshold` successes),
 * which is what keeps a single blip from paging anyone.
 */
export function applyResult(
  previous: StateSnapshot,
  result: ProbeResult,
  thresholds: Thresholds,
): { next: StateSnapshot; transitioned: boolean } {
  const consecutiveFailures = result.ok ? 0 : previous.consecutiveFailures + 1;
  const consecutiveSuccesses = result.ok ? previous.consecutiveSuccesses + 1 : 0;

  let state = previous.state;
  if (!result.ok && consecutiveFailures >= thresholds.failureThreshold) state = 'down';
  else if (result.ok && consecutiveSuccesses >= thresholds.recoveryThreshold) state = 'up';

  const transitioned = state !== previous.state;
  return {
    next: {
      state,
      since: transitioned ? result.checkedAt : previous.since,
      consecutiveFailures,
      consecutiveSuccesses,
    },
    transitioned,
  };
}
