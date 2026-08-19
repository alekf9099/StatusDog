import type { ProbeResult, ResolvedTarget } from '../config/types.js';
import type { TargetState } from '../monitor/transition.js';
import type { KvClient } from './kv.js';
import {
  applyTransition,
  emptyStats,
  foldCheck,
  type TargetStats,
} from './rollup.js';

/**
 * Persistence for the long memory.
 *
 * Kept in its own key rather than alongside the raw checks, because the dashboard
 * and the office poll `/api/monitors` every minute and have no use for thirteen
 * months of daily buckets. One extra read and write per target per run buys a
 * payload that stays small for the thing that is fetched constantly.
 */

const KEY_PREFIX = 'statusdog:v2:stats:';

function keyFor(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function readStats(
  kv: KvClient,
  id: string,
  offsetMinutes = 0,
): Promise<TargetStats> {
  const raw = await kv.get(keyFor(id));
  if (raw === null) return emptyStats(id, offsetMinutes);

  try {
    const parsed = JSON.parse(raw) as Partial<TargetStats>;
    return {
      id,
      daily: Array.isArray(parsed.daily) ? parsed.daily : [],
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      // The stored offset wins: changing the config must not silently relabel
      // buckets that were already cut on the old boundary.
      offsetMinutes: typeof parsed.offsetMinutes === 'number' ? parsed.offsetMinutes : offsetMinutes,
    };
  } catch {
    return emptyStats(id, offsetMinutes);
  }
}

export async function writeStats(kv: KvClient, stats: TargetStats): Promise<void> {
  await kv.set(keyFor(stats.id), JSON.stringify(stats));
}

export interface RecordOptions {
  offsetMinutes?: number;
  /** State before this check, so downtime can be attributed to the gap. */
  previousState?: TargetState;
  /** When the previous check happened, for the same reason. */
  previousCheckedAt?: string | null;
  /** A confirmed state change, if this check produced one. */
  transitionedTo?: TargetState | null;
}

/**
 * Fold one check into the stored rollups, and open or close an incident.
 *
 * Read-modify-write with no locking, like the rest of the store: two overlapping
 * cron runs could lose a data point, which costs a bucket count and never
 * corrupts the shape.
 */
export async function recordCheck(
  kv: KvClient,
  target: Pick<ResolvedTarget, 'id'>,
  result: ProbeResult,
  options: RecordOptions = {},
): Promise<TargetStats> {
  const stats = await readStats(kv, target.id, options.offsetMinutes ?? 0);

  const previousMs = options.previousCheckedAt ? Date.parse(options.previousCheckedAt) : NaN;
  const currentMs = Date.parse(result.checkedAt);
  const elapsedMs = Number.isFinite(previousMs) && Number.isFinite(currentMs)
    ? Math.max(0, currentMs - previousMs)
    : 0;

  let next = foldCheck(stats, result, {
    elapsedMs,
    previousState: options.previousState,
  });

  if (options.transitionedTo) {
    next = applyTransition(next, options.transitionedTo, result.checkedAt, result);
  }

  await writeStats(kv, next);
  return next;
}

export async function readAllStats(
  kv: KvClient,
  ids: string[],
  offsetMinutes = 0,
): Promise<TargetStats[]> {
  return Promise.all(ids.map((id) => readStats(kv, id, offsetMinutes)));
}

export async function clearStats(kv: KvClient, id: string): Promise<void> {
  await kv.del(keyFor(id));
}
