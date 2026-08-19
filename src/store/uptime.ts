import type { ProbeResult, ResolvedTarget } from '../config/types.js';
import { applyResult, INITIAL_STATE, type StateSnapshot } from '../monitor/transition.js';
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
  reason: string | null;
}

export interface UptimeEntry extends StateSnapshot {
  id: string;
  name: string;
  url: string;
  lastResult: ProbeResult | null;
  history: UptimeRecord[];
}

export interface UptimeStats {
  checks: number;
  failures: number;
  uptimePct: number | null;
  avgResponseTimeMs: number | null;
  lastCheckedAt: string | null;
}

export function statsFor(entry: UptimeEntry): UptimeStats {
  const history = entry.history ?? [];
  if (history.length === 0) {
    return { checks: 0, failures: 0, uptimePct: null, avgResponseTimeMs: null, lastCheckedAt: null };
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

function keyFor(targetId: string): string {
  return `${KEY_PREFIX}${targetId}`;
}

function blankEntry(target: Pick<ResolvedTarget, 'id' | 'name' | 'url'>): UptimeEntry {
  return { ...INITIAL_STATE, id: target.id, name: target.name, url: target.url, lastResult: null, history: [] };
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
    };
  } catch {
    return blankEntry(target);
  }
}

export async function writeEntry(kv: KvClient, entry: UptimeEntry): Promise<void> {
  await kv.set(keyFor(entry.id), JSON.stringify(entry));
}

export interface AppliedCheck {
  entry: UptimeEntry;
  transitioned: boolean;
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
): Promise<AppliedCheck> {
  const previous = await readEntry(kv, target);
  const { next, transitioned } = applyResult(previous, result, target);

  const entry: UptimeEntry = {
    ...previous,
    ...next,
    lastResult: result,
    history: [
      ...previous.history,
      { t: result.checkedAt, ok: result.ok, status: result.status, ms: result.responseTimeMs, reason: result.reason },
    ].slice(-HISTORY_LIMIT),
  };

  await writeEntry(kv, entry);
  return { entry, transitioned };
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
