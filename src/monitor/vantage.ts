import type { ExpectStatus, FailureReason } from '../config/types.js';
import { statusMatches } from './matchers.js';

/**
 * A second opinion from another network.
 *
 * This exists because of a real false alarm. copykiller.com answers in ~200ms from
 * Seoul; from Vercel's US-East region it once took 30 seconds and timed out, and
 * StatusDog duly reported an outage and sent an alert. The site was fine. What was
 * being measured was a transpacific round trip.
 *
 * One observer cannot tell "the site is down" from "the path to the site is down".
 * Two observers on different networks can: if they disagree, the honest answer is
 * that we do not know, and a check we cannot interpret should page nobody and stay
 * out of the uptime figures.
 *
 * The runner only measures — it reports a raw status code and whether the request
 * completed. Whether that counts as healthy is decided here, against the target's
 * own `expectStatus`, so the policy lives in one place.
 *
 * Only failures that *could* be caused by the network are ever disputed. A page
 * that answered with a forbidden string, a missing security header or the wrong
 * status code has answered: that verdict is about the site, and a second network
 * has no standing to overrule it. Suppressing those would turn this feature into
 * a way of hiding real content faults.
 */

/** What the second vantage reports per target. Deliberately minimal. */
export interface VantageReport {
  id: string;
  /** Whether the request completed at all from that network. */
  reachable: boolean;
  status: number | null;
  responseTimeMs?: number | null;
}

export interface VantagePayload {
  /** Where the second opinion came from, for the record. */
  name: string;
  checks: VantageReport[];
}

export type VantageOutcome =
  /** No second opinion was supplied. The primary stands alone. */
  | 'unwitnessed'
  /** Both observers saw it working. */
  | 'confirmed-ok'
  /** Both observers saw it failing — an outage two networks agree on. */
  | 'confirmed-failed'
  /** The primary failed and the second vantage did not. We cannot tell. */
  | 'disputed'
  /** Disputed too many times running: stop suppressing and treat it as failed. */
  | 'dispute-exhausted'
  /** The primary succeeded and the second vantage did not. */
  | 'secondary-disagrees'
  /**
   * The primary failed on the response itself, not on reaching it. The second
   * vantage's opinion is irrelevant and the primary's verdict stands.
   */
  | 'content-failure';

export interface Reconciliation {
  outcome: VantageOutcome;
  /**
   * Whether this check should be folded into the state machine and the rollups.
   *
   * `false` only for `disputed` — a result nobody can interpret must not flip a
   * target to down, and must not drag the uptime figure either way.
   */
  conclusive: boolean;
  /** One line for the response and the run summary. `null` when unremarkable. */
  note: string | null;
}

/**
 * How many disputes in a row before the second vantage stops being believed.
 *
 * Without this the feature fails open: a runner whose own network is broken would
 * report every target as reachable and mute a genuine outage indefinitely. Three
 * disputes is roughly an hour and a half at the observed cadence — long enough to
 * ride out a transient routing problem, short enough that a real outage still pages.
 *
 * Exhaustion sticks: the run keeps growing while the disagreement continues, so once
 * the second opinion has been set aside it stays set aside until it agrees again.
 * Resetting on the exhausted check itself would mute every fourth check indefinitely.
 */
export const MAX_CONSECUTIVE_DISPUTES = 3;

/**
 * Failure reasons a different network could plausibly change.
 *
 * Everything else — a wrong status, forbidden text in the body, a missing header,
 * a redirect chain that changed shape — is the site's own answer, identical from
 * anywhere, and is never suppressed.
 */
const TRANSPORT_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'timeout',
  'dns',
  'refused',
  'network',
  // Latency is the original false alarm: 200ms from Seoul, 30s from US-East.
  'slow',
  // A handshake that fails on the path rather than on the certificate. When the
  // certificate itself is bad the second vantage cannot connect either, so this
  // resolves to a confirmed failure anyway.
  'tls',
]);

/** Could a different network have produced a different answer? */
export function isDisputable(reason: FailureReason | null | undefined): boolean {
  return reason != null && TRANSPORT_REASONS.has(reason);
}

/** Did the second vantage consider this target healthy? */
export function vantageSaysOk(report: VantageReport | null, expectStatus: ExpectStatus[]): boolean {
  if (!report || !report.reachable) return false;
  if (report.status === null || !Number.isFinite(report.status)) return false;
  return statusMatches(report.status, expectStatus);
}

export function findVantageReport(
  payload: VantagePayload | null | undefined,
  id: string,
): VantageReport | null {
  if (!payload || !Array.isArray(payload.checks)) return null;
  return payload.checks.find((check) => check && check.id === id) ?? null;
}

export function reconcile(options: {
  primaryOk: boolean;
  report: VantageReport | null;
  expectStatus: ExpectStatus[];
  /** Why the primary failed. Only transport failures can be disputed. */
  reason?: FailureReason | null;
  /** How many times in a row this target has already been disputed. */
  consecutiveDisputes: number;
  vantageName?: string;
}): Reconciliation {
  const { primaryOk, report, expectStatus, consecutiveDisputes } = options;
  const where = options.vantageName ?? 'the second vantage';

  if (!report) {
    return { outcome: 'unwitnessed', conclusive: true, note: null };
  }

  const secondaryOk = vantageSaysOk(report, expectStatus);

  if (primaryOk && secondaryOk) {
    return { outcome: 'confirmed-ok', conclusive: true, note: null };
  }

  if (!primaryOk && !secondaryOk) {
    return {
      outcome: 'confirmed-failed',
      conclusive: true,
      note: `Failing from both vantage points, including ${where}.`,
    };
  }

  if (primaryOk && !secondaryOk) {
    // The primary is the region that serves the dashboard, so it decides the state.
    // The disagreement is still worth recording: it usually means a routing problem
    // somewhere else, and it is the early warning for one.
    return {
      outcome: 'secondary-disagrees',
      conclusive: true,
      note: `Healthy from the primary vantage but not from ${where}.`,
    };
  }

  // Primary failed, second vantage did not.
  if (!isDisputable(options.reason)) {
    return {
      outcome: 'content-failure',
      conclusive: true,
      note:
        `Failed from the primary vantage on the response itself (${options.reason ?? 'unknown'}), ` +
        `so ${where} reaching it does not contradict the failure.`,
    };
  }

  if (consecutiveDisputes + 1 > MAX_CONSECUTIVE_DISPUTES) {
    return {
      outcome: 'dispute-exhausted',
      conclusive: true,
      note:
        `Failing from the primary vantage for ${consecutiveDisputes + 1} checks running while ` +
        `${where} still reaches it. Treating it as a real failure — the second opinion ` +
        `may itself be wrong.`,
    };
  }

  return {
    outcome: 'disputed',
    conclusive: false,
    note:
      `Failed from the primary vantage but ${where} reached it fine, so this check is ` +
      `inconclusive: it is not counted and nobody is paged.`,
  };
}

/**
 * Track the run of consecutive disputes that {@link reconcile} needs.
 *
 * Both `disputed` and `dispute-exhausted` extend the run: they are the same
 * disagreement, and only the second vantage agreeing again ends it.
 */
export function nextDisputeCount(current: number, outcome: VantageOutcome): number {
  const count = Number.isFinite(current) && current > 0 ? current : 0;
  return outcome === 'disputed' || outcome === 'dispute-exhausted' ? count + 1 : 0;
}
