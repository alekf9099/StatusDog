import type { ProbeResult, ResolvedTarget } from '../config/types.js';
import type { TargetState } from '../monitor/transition.js';

/**
 * Daily rollups and incidents — the long memory.
 *
 * Raw checks are capped at 480 per target, which is about five days at a
 * fifteen-minute cadence. That is plenty for a sparkline and useless for "how did
 * last month go", so weekly and monthly figures are built from daily buckets
 * instead: one small record per day, folded in as each check arrives.
 *
 * Percentiles come from a fixed histogram rather than stored samples. Keeping
 * every latency for a month would be ~3000 numbers per target; a handful of counters give
 * a p50 and p95 that are accurate to a bucket and, crucially, **mergeable** — a
 * weekly percentile is the sum of seven days' counters, which a stored average
 * could never give you.
 */

/**
 * Upper bounds in ms; the last bucket catches everything above.
 *
 * Weighted towards the low end on purpose. Most things worth monitoring answer in
 * well under a second, and with coarse buckets a site sitting between 90ms and
 * 160ms had the same p50 and p95 — technically true, and useless. Fifteen counters
 * is still under 200 bytes a day.
 */
export const LATENCY_BUCKETS = [
  25, 50, 75, 100, 150, 200, 300, 500, 800, 1200, 2000, 3200, 6400, 12800, Infinity,
];

/** About thirteen months, which covers a year-on-year glance. */
export const DAILY_LIMIT = 400;
/** Enough to show a year of outages without unbounded growth. */
export const INCIDENT_LIMIT = 200;

export interface DailyBucket {
  /** `YYYY-MM-DD` in the configured timezone. */
  day: string;
  checks: number;
  failures: number;
  /** Sum of response times, for the mean. */
  sumMs: number;
  maxMs: number;
  /** Counts per {@link LATENCY_BUCKETS}, successful checks only. */
  histogram: number[];
  /** Wall-clock time the target was considered down, in ms. */
  downtimeMs: number;
}

export interface Incident {
  startedAt: string;
  /** `null` while it is still going on. */
  endedAt: string | null;
  durationMs: number | null;
  reason: string | null;
  status: number | null;
  message: string | null;
}

export interface TargetStats {
  id: string;
  daily: DailyBucket[];
  incidents: Incident[];
  /** Timezone offset the buckets were cut on, so a reader knows what a day means. */
  offsetMinutes: number;
}

export function emptyStats(id: string, offsetMinutes = 0): TargetStats {
  return { id, daily: [], incidents: [], offsetMinutes };
}

/**
 * The day a timestamp belongs to, shifted by `offsetMinutes`.
 *
 * A Korean team reading "19일 가동률" means 19 August in Seoul, so the boundary is
 * configurable rather than always UTC.
 */
export function dayKeyOf(iso: string | number | Date, offsetMinutes = 0): string {
  const ms = iso instanceof Date ? iso.getTime() : typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return 'invalid';
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function bucketIndexOf(ms: number): number {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (value <= LATENCY_BUCKETS[i]!) return i;
  }
  return LATENCY_BUCKETS.length - 1;
}

function blankBucket(day: string): DailyBucket {
  return {
    day,
    checks: 0,
    failures: 0,
    sumMs: 0,
    maxMs: 0,
    histogram: new Array(LATENCY_BUCKETS.length).fill(0),
    downtimeMs: 0,
  };
}

/** Tolerate buckets written by an older version, or by nothing at all. */
function normalizeBucket(input: Partial<DailyBucket> | undefined, day: string): DailyBucket {
  const blank = blankBucket(day);
  if (!input) return blank;
  const histogram = Array.isArray(input.histogram) && input.histogram.length === LATENCY_BUCKETS.length
    ? input.histogram.map((count) => (Number.isFinite(count) ? count : 0))
    : blank.histogram;
  return {
    day: input.day ?? day,
    checks: num(input.checks),
    failures: num(input.failures),
    sumMs: num(input.sumMs),
    maxMs: num(input.maxMs),
    histogram,
    downtimeMs: num(input.downtimeMs),
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export interface FoldOptions {
  /** Milliseconds since the previous check, used to attribute downtime. */
  elapsedMs?: number;
  /** State *before* this check, so a still-down interval counts as downtime. */
  previousState?: TargetState;
}

/**
 * Fold one check into the daily buckets.
 *
 * Downtime is attributed to the interval *preceding* this check when the target
 * was already down — a target that failed at 03:00 and recovered at 03:45 was
 * down for the gap between, not for an instant.
 */
export function foldCheck(
  stats: TargetStats,
  result: ProbeResult,
  options: FoldOptions = {},
): TargetStats {
  const day = dayKeyOf(result.checkedAt, stats.offsetMinutes);
  const daily = stats.daily.map((bucket) => normalizeBucket(bucket, bucket.day ?? day));
  const index = daily.findIndex((bucket) => bucket.day === day);
  const bucket = index === -1 ? blankBucket(day) : daily[index]!;

  bucket.checks += 1;
  if (result.ok) {
    bucket.sumMs += num(result.responseTimeMs);
    bucket.maxMs = Math.max(bucket.maxMs, num(result.responseTimeMs));
    bucket.histogram[bucketIndexOf(result.responseTimeMs)] += 1;
  } else {
    bucket.failures += 1;
  }

  // Only count downtime for an interval we actually observed, and cap it so a
  // scheduler that was off for a week does not report a week of downtime it never
  // measured.
  const elapsed = num(options.elapsedMs);
  if (options.previousState === 'down' && elapsed > 0) {
    bucket.downtimeMs += Math.min(elapsed, 6 * 3_600_000);
  }

  if (index === -1) daily.push(bucket);
  else daily[index] = bucket;

  daily.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  return { ...stats, daily: daily.slice(-DAILY_LIMIT) };
}

/* ---------------- incidents ---------------- */

/**
 * Open or close an incident on a confirmed state change.
 *
 * Only confirmed transitions land here, so an incident always represents a real
 * outage rather than a single failed request.
 */
export function applyTransition(
  stats: TargetStats,
  to: TargetState,
  at: string,
  result: ProbeResult,
): TargetStats {
  const incidents = [...stats.incidents];
  const open = incidents.find((incident) => incident.endedAt === null);

  if (to === 'down') {
    // Already tracking one; a second "down" without an intervening "up" should
    // not start a duplicate.
    if (open) return stats;
    incidents.push({
      startedAt: at,
      endedAt: null,
      durationMs: null,
      reason: result.reason ?? null,
      status: result.status ?? null,
      message: result.message ?? null,
    });
    return { ...stats, incidents: incidents.slice(-INCIDENT_LIMIT) };
  }

  if (to === 'up' && open) {
    const startedMs = Date.parse(open.startedAt);
    const endedMs = Date.parse(at);
    open.endedAt = at;
    open.durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, endedMs - startedMs)
      : null;
    return { ...stats, incidents: incidents.slice(-INCIDENT_LIMIT) };
  }

  return stats;
}

/* ---------------- summaries ---------------- */

export interface PeriodSummary {
  /** How many days the window covers. */
  days: number;
  from: string | null;
  to: string | null;
  checks: number;
  failures: number;
  uptimePct: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  downtimeMs: number;
  incidents: number;
  /** Days in the window that actually have data, so gaps are visible. */
  daysWithData: number;
}

/** Percentile from merged histograms. Accurate to a bucket, and honest about it. */
function percentileFrom(histogram: number[], fraction: number): number | null {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const target = total * fraction;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i]!;
    if (seen >= target) {
      const bound = LATENCY_BUCKETS[i]!;
      // The open-ended top bucket has no upper bound to report.
      return Number.isFinite(bound) ? bound : LATENCY_BUCKETS[LATENCY_BUCKETS.length - 2]!;
    }
  }
  return null;
}

/**
 * Summarise the most recent `days` buckets.
 *
 * `endDay` lets a caller ask for a window that is not "up to today", which the
 * tests rely on and a month-over-month comparison would want.
 */
export function summarize(
  stats: TargetStats,
  days: number,
  endDay: string = dayKeyOf(Date.now(), stats.offsetMinutes),
): PeriodSummary {
  const start = shiftDay(endDay, -(days - 1));
  const window = stats.daily.filter((bucket) => bucket.day >= start && bucket.day <= endDay);

  const merged = window.reduce<DailyBucket>(
    (acc, raw) => {
      const bucket = normalizeBucket(raw, raw.day);
      acc.checks += bucket.checks;
      acc.failures += bucket.failures;
      acc.sumMs += bucket.sumMs;
      acc.maxMs = Math.max(acc.maxMs, bucket.maxMs);
      acc.downtimeMs += bucket.downtimeMs;
      for (let i = 0; i < acc.histogram.length; i++) acc.histogram[i]! += bucket.histogram[i] ?? 0;
      return acc;
    },
    blankBucket(endDay),
  );

  const successes = merged.checks - merged.failures;
  const incidents = stats.incidents.filter((incident) => {
    const day = dayKeyOf(incident.startedAt, stats.offsetMinutes);
    return day >= start && day <= endDay;
  }).length;

  return {
    days,
    from: window.length > 0 ? window[0]!.day : null,
    to: window.length > 0 ? window[window.length - 1]!.day : null,
    checks: merged.checks,
    failures: merged.failures,
    uptimePct: merged.checks === 0
      ? null
      : Math.round((successes / merged.checks) * 10_000) / 100,
    avgMs: successes > 0 ? Math.round(merged.sumMs / successes) : null,
    p50Ms: percentileFrom(merged.histogram, 0.5),
    p95Ms: percentileFrom(merged.histogram, 0.95),
    maxMs: merged.maxMs > 0 ? merged.maxMs : null,
    downtimeMs: merged.downtimeMs,
    incidents,
    daysWithData: window.length,
  };
}

/** `YYYY-MM-DD` plus or minus whole days, without pulling in a date library. */
export function shiftDay(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return day;
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10);
}
