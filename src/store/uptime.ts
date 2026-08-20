import type { FailureReason, ProbeResult, ResolvedTarget } from '../config/types.js';
import {
  applyResult,
  INITIAL_STATE,
  type StateSnapshot,
  type TargetState,
} from '../monitor/transition.js';
import { evaluateCertExpiry, EMPTY_CERT_STATE, type CertEvaluation, type CertNotifyState } from '../monitor/cert.js';
import type { KvClient } from './kv.js';

/** Bump when the stored shape changes so old records are simply ignored. */
const KEY_PREFIX = 'statusdog:v1:target:';

/**
 * Checks retained per target. At one check every 15 minutes this is ~5 days of
 * history, which is enough for a dashboard without turning a KV value into
 * something that has to be paged.
 */
export const HISTORY_LIMIT = 480;

/** One stored check. Field names are short because this list is the bulk of the value. */
export interface UptimeRecord {
  t: string;
  ok: boolean;
  status: number | null;
  ms: number;
  /**
   * A {@link FailureReason}, `null` on success, or `'disputed'` when two vantage
   * points could not agree — the one value that is not a verdict about the site.
   */
  reason: FailureReason | 'disputed' | null;
}

export interface UptimeEntry extends StateSnapshot {
  id: string;
  name: string;
  url: string;
  lastResult: ProbeResult | null;
  history: UptimeRecord[];
  /** Which certificate expiry warnings have already gone out, and for which cert. */
  cert: CertNotifyState;
  /**
   * Failures the second vantage would not corroborate, in a row. Reset by any
   * conclusive check; used to stop a broken second opinion muting a real outage.
   */
  consecutiveDisputes: number;
  /** Total inconclusive checks, so the dashboard can say the network was unclear. */
  disputes: number;
  /**
   * The most recent check no conclusion could be drawn from.
   *
   * Kept separate from `lastResult`, which stays the last check that actually
   * counted. Overwriting `lastResult` with a disputed failure would paint the
   * dashboard red over a check we have just declared uninterpretable — while
   * hiding the disagreement entirely would be no better.
   */
  lastDispute: { at: string; message: string | null; reason: FailureReason | null } | null;
}

export interface UptimeStats {
  checks: number;
  failures: number;
  uptimePct: number | null;
  avgResponseTimeMs: number | null;
  lastCheckedAt: string | null;
}

export function statsFor(entry: UptimeEntry): UptimeStats {
  const all = entry.history ?? [];
  // Checks two vantage points could not agree on are still in the history, so the
  // disagreement is visible — but they must not reach the figures. Counting one as a
  // failure would put the false alarm straight back into the uptime percentage, and
  // its timed-out duration would drag the average with it.
  const history = all.filter((record) => record.reason !== 'disputed');
  if (history.length === 0) {
    return {
      checks: 0,
      failures: 0,
      uptimePct: null,
      avgResponseTimeMs: null,
      // Something did happen, even if nothing could be concluded from it.
      lastCheckedAt: all.length > 0 ? all[all.length - 1]!.t : null,
    };
  }
  let failures = 0;
  let totalMs = 0;
  for (const record of history) {
    if (!record.ok) failures++;
    totalMs += record.ms;
  }
  return {
    checks: history.length,
    failures,
    uptimePct: Math.round(((history.length - failures) / history.length) * 10_000) / 100,
    avgResponseTimeMs: Math.round(totalMs / history.length),
    lastCheckedAt: history[history.length - 1]!.t,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function keyFor(targetId: string): string {
  return `${KEY_PREFIX}${targetId}`;
}

function blankEntry(target: Pick<ResolvedTarget, 'id' | 'name' | 'url'>): UptimeEntry {
  return {
    ...INITIAL_STATE,
    id: target.id,
    name: target.name,
    url: target.url,
    lastResult: null,
    history: [],
    cert: { ...EMPTY_CERT_STATE },
    consecutiveDisputes: 0,
    disputes: 0,
    lastDispute: null,
  };
}

/** Read one target's stored state. Corrupt or absent values read as blank. */
export async function readEntry(
  kv: KvClient,
  target: Pick<ResolvedTarget, 'id' | 'name' | 'url'>,
): Promise<UptimeEntry> {
  const raw = await kv.get(keyFor(target.id));
  if (raw === null) return blankEntry(target);

  try {
    const parsed = JSON.parse(raw) as Partial<UptimeEntry>;
    return {
      ...blankEntry(target),
      ...parsed,
      // Name and URL come from the roster, not the store: editing monitors.json
      // should rename a monitor rather than be silently overridden by old data.
      id: target.id,
      name: target.name,
      url: target.url,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_LIMIT) : [],
      // Absent on entries written before expiry warnings existed.
      cert: parsed.cert ?? { ...EMPTY_CERT_STATE },
      consecutiveDisputes: numberOr(parsed.consecutiveDisputes, 0),
      disputes: numberOr(parsed.disputes, 0),
      lastDispute: parsed.lastDispute ?? null,
    };
  } catch {
    return blankEntry(target);
  }
}

export async function writeEntry(kv: KvClient, entry: UptimeEntry): Promise<void> {
  await kv.set(keyFor(entry.id), JSON.stringify(entry));
}

export interface ApplyOptions {
  /**
   * Set when a second vantage could not corroborate this failure. An inconclusive
   * check is stored, but it does not move the state machine — a result nobody can
   * interpret must not flip a target to down.
   */
  inconclusive?: boolean;
  /**
   * The new length of the disagreement run, when the caller has already worked it
   * out. It is not the same as the count of suppressed checks: a disagreement that
   * has exhausted its patience still counts, or the second vantage would mute every
   * fourth check forever. Defaults to "+1 while suppressed, 0 otherwise".
   */
  disputeRun?: number;
}

export interface AppliedCheck {
  entry: UptimeEntry;
  transitioned: boolean;
  /** Whether this check crossed a certificate expiry threshold. */
  cert: CertEvaluation;
  /**
   * The state this check moved away from.
   *
   * Callers building an alert need it and cannot infer it: the previous state may
   * have been `unknown`, so "the opposite of the new state" is wrong on a
   * target's very first check.
   */
  previousState: TargetState;
}

/**
 * Fold a probe result into stored state and persist it.
 *
 * Read-modify-write with no locking. That is fine for a scheduler that runs one
 * job at a time; two overlapping cron runs could drop a record, which costs a
 * data point and never corrupts the state machine.
 */
export async function applyCheck(
  kv: KvClient,
  target: ResolvedTarget,
  result: ProbeResult,
  options: ApplyOptions = {},
): Promise<AppliedCheck> {
  const previous = await readEntry(kv, target);

  // An inconclusive check leaves the state machine exactly where it was: the
  // streak counters must not advance either, or three disputed checks would look
  // like three failures once one finally counts.
  const { next, transitioned } = options.inconclusive
    ? {
        next: {
          state: previous.state,
          since: previous.since,
          consecutiveFailures: previous.consecutiveFailures,
          consecutiveSuccesses: previous.consecutiveSuccesses,
        },
        transitioned: false,
      }
    : applyResult(previous, result, target);
  const cert = evaluateCertExpiry(
    result.detail?.tls ?? null,
    target.certExpiryWarnDays,
    previous.cert,
  );

  const entry: UptimeEntry = {
    ...previous,
    ...next,
    // A disputed check leaves the last *conclusive* result standing, because that
    // is what the state, the badges and the dogs are showing. The disagreement is
    // not swept away: it goes in the history and in `lastDispute`.
    lastResult: options.inconclusive ? previous.lastResult : result,
    lastDispute: options.inconclusive
      ? { at: result.checkedAt, message: result.message, reason: result.reason }
      : previous.lastDispute,
    // The raw history still records what happened, so a dispute is visible rather
    // than erased — it simply does not count towards the state or the statistics.
    history: [
      ...previous.history,
      {
        t: result.checkedAt,
        ok: result.ok,
        status: result.status,
        ms: result.responseTimeMs,
        // `as const` because `.slice` below detaches the literal from its
        // contextual type, which would widen this to `string`.
        reason: options.inconclusive ? ('disputed' as const) : result.reason,
      } satisfies UptimeRecord,
    ].slice(-HISTORY_LIMIT),
    cert: cert.state,
    consecutiveDisputes: options.disputeRun ?? (options.inconclusive ? previous.consecutiveDisputes + 1 : 0),
    disputes: previous.disputes + (options.inconclusive ? 1 : 0),
  };

  await writeEntry(kv, entry);
  return { entry, transitioned, previousState: previous.state, cert };
}

/** Read every roster target's state, in roster order. */
export async function readAll(
  kv: KvClient,
  targets: Array<Pick<ResolvedTarget, 'id' | 'name' | 'url'>>,
): Promise<UptimeEntry[]> {
  return Promise.all(targets.map((target) => readEntry(kv, target)));
}

export async function clearEntry(kv: KvClient, targetId: string): Promise<void> {
  await kv.del(keyFor(targetId));
}
