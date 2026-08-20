import type { ProbeResult } from '../config/types.js';
import type { UptimeRecord } from './uptime.js';

/**
 * What happened, and what was different when it came back.
 *
 * An incident used to be six fields: when it started, when it ended, how long, and
 * a single word like `timeout`. That tells you an outage occurred and nothing about
 * it. This builds the report instead.
 *
 * The split matters. StatusDog watches from *outside* the site, so it can record in
 * detail **what it observed** and it cannot know **what somebody did about it**. No
 * probe can see a service being restarted or a deploy being rolled back. Rather than
 * guess, the report keeps two snapshots — the moment it was called down, and the
 * moment it came back — and lists what differs between them. An address that
 * changed, a `server` header that changed, a page that went from 512 bytes to 84KB:
 * that is evidence about the fix, presented as evidence and never as a conclusion.
 * The cause and the remedy are for a person to write down.
 */

/** How many reports are kept per target. Detail is expensive; a summary is not. */
export const REPORT_LIMIT = 30;

/** Healthy checks kept from just before the trouble started. */
export const PRECURSOR_POINTS = 8;

/**
 * A response size is never identical twice, so only a real change is worth
 * reporting: appearing, vanishing, or moving by more than a quarter.
 */
const SIZE_CHANGE_RATIO = 1.25;

export interface IncidentSnapshot {
  at: string;
  status: number | null;
  responseTimeMs: number | null;
  reason: string | null;
  message: string | null;
  finalUrl: string | null;
  redirects: number | null;
  /** Which address answered. */
  peer: string | null;
  server: string | null;
  contentType: string | null;
  bodySize: number | null;
  /** Only ever populated on the failing side. */
  bodyExcerpt: string | null;
  certFingerprint: string | null;
  certIssuer: string | null;
  certValidTo: string | null;
  tlsProtocol: string | null;
}

/** A check from just before the failure, so a slow decline is visible. */
export interface PrecursorPoint {
  t: string;
  ok: boolean;
  ms: number;
  reason: string | null;
}

/** One observed difference between the failing and the recovered response. */
export interface SnapshotChange {
  /** Machine name; the UI supplies the wording, so the store stays language-free. */
  field: 'peer' | 'server' | 'contentType' | 'bodySize' | 'finalUrl' | 'redirects'
    | 'certFingerprint' | 'certIssuer' | 'tlsProtocol';
  from: string | null;
  to: string | null;
}

export interface IncidentReport {
  /** The confirmed-down timestamp, which is also the incident's identity. */
  id: string;
  targetId: string;
  /** When the threshold was crossed and StatusDog called it down. */
  confirmedAt: string;
  /** The first failing check of the run — usually earlier than `confirmedAt`. */
  firstFailureAt: string | null;
  /** Counted failures leading to confirmation, including the confirming one. */
  failureChecks: number;
  /**
   * How long the failure went unconfirmed. This is the price of
   * `failureThreshold`, stated plainly rather than hidden.
   */
  detectionMs: number | null;
  firstSuccessAt: string | null;
  recoveredAt: string | null;
  durationMs: number | null;
  failure: IncidentSnapshot;
  /** `null` while the incident is still open. */
  recovery: IncidentSnapshot | null;
  /** Observed differences on recovery. Evidence about the fix, not the fix. */
  changed: SnapshotChange[];
  precursor: PrecursorPoint[];
  /** Whether a second vantage point corroborated the failure. */
  vantage: string | null;
  /** Whether anyone was actually told, filled in once the fan-out has run. */
  alerts: { attempted: number; delivered: number; failed: number } | null;
}

export interface IncidentLog {
  targetId: string;
  reports: IncidentReport[];
}

export function emptyLog(targetId: string): IncidentLog {
  return { targetId, reports: [] };
}

/* ---------------- snapshots ---------------- */

export function snapshotOf(result: ProbeResult): IncidentSnapshot {
  const detail = result.detail;
  return {
    at: result.checkedAt,
    status: result.status ?? null,
    responseTimeMs: Number.isFinite(result.responseTimeMs) ? result.responseTimeMs : null,
    reason: result.reason ?? null,
    message: result.message ?? null,
    finalUrl: result.finalUrl ?? null,
    redirects: Number.isFinite(result.redirects) ? result.redirects : null,
    peer: detail?.peer ?? null,
    server: detail?.headers?.server ?? null,
    contentType: detail?.headers?.['content-type'] ?? null,
    bodySize: detail?.bodySize ?? null,
    bodyExcerpt: detail?.bodyExcerpt ?? null,
    certFingerprint: detail?.tls?.fingerprint ?? null,
    certIssuer: detail?.tls?.issuer ?? null,
    certValidTo: detail?.tls?.validTo ?? null,
    tlsProtocol: detail?.tls?.protocol ?? null,
  };
}

function sizeChanged(from: number | null, to: number | null): boolean {
  if (from === to) return false;
  if (from === null || to === null) return true;
  // A page appearing or vanishing is always worth saying.
  if (from === 0 || to === 0) return true;
  const ratio = Math.max(from, to) / Math.min(from, to);
  return ratio >= SIZE_CHANGE_RATIO;
}

/**
 * What is observably different now that it works.
 *
 * The symptom fields — status, latency, reason — are deliberately not compared.
 * "It was failing and now it is not" is the definition of a recovery, not a finding;
 * these are the fields that might say *why*.
 */
export function diffSnapshots(
  failure: IncidentSnapshot,
  recovery: IncidentSnapshot,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];

  const compare = (field: SnapshotChange['field'], from: unknown, to: unknown) => {
    const a = from === null || from === undefined ? null : String(from);
    const b = to === null || to === undefined ? null : String(to);
    if (a !== b) changes.push({ field, from: a, to: b });
  };

  compare('peer', failure.peer, recovery.peer);
  compare('server', failure.server, recovery.server);
  compare('contentType', failure.contentType, recovery.contentType);
  if (sizeChanged(failure.bodySize, recovery.bodySize)) {
    changes.push({
      field: 'bodySize',
      from: failure.bodySize === null ? null : String(failure.bodySize),
      to: recovery.bodySize === null ? null : String(recovery.bodySize),
    });
  }
  compare('finalUrl', failure.finalUrl, recovery.finalUrl);
  compare('redirects', failure.redirects, recovery.redirects);
  compare('certFingerprint', failure.certFingerprint, recovery.certFingerprint);
  compare('certIssuer', failure.certIssuer, recovery.certIssuer);
  compare('tlsProtocol', failure.tlsProtocol, recovery.tlsProtocol);

  return changes;
}

/* ---------------- reading the run out of the history ---------------- */

export interface FailureRun {
  firstFailureAt: string | null;
  failureChecks: number;
  precursor: PrecursorPoint[];
}

/**
 * Walk back through the stored checks to find where the trouble actually began.
 *
 * `confirmedAt` is when the threshold was crossed, which is one or more checks
 * *after* the first sign of a problem. The gap between the two is the detection
 * delay, and the checks before it are where a slow decline shows up.
 *
 * Disputed checks are skipped rather than treated either way: they did not count
 * towards the failure, so they must not extend the run, and they were not healthy,
 * so they must not end it.
 */
export function failureRunOf(history: UptimeRecord[], confirmingAt: string): FailureRun {
  const points = Array.isArray(history) ? history : [];

  // Everything up to and including the confirming check. A history that has not
  // been written yet simply yields the whole list.
  const end = points.findIndex((point) => point.t === confirmingAt);
  const upTo = end === -1 ? points : points.slice(0, end + 1);

  let failureChecks = 0;
  let firstFailureAt: string | null = null;
  // Where the counted run begins. The precursor stops here, which keeps any
  // disputed check immediately before the outage *in* the precursor — a
  // disagreement right before a real failure is worth seeing, not hiding.
  let runStart = upTo.length;

  for (let index = upTo.length - 1; index >= 0; index--) {
    const point = upTo[index]!;
    if (point.reason === 'disputed') continue;
    if (point.ok) break;
    failureChecks++;
    firstFailureAt = point.t;
    runStart = index;
  }

  // The confirming check itself may not be in the history yet.
  if (failureChecks === 0) {
    failureChecks = 1;
    firstFailureAt = confirmingAt;
  }

  const precursor = upTo
    .slice(Math.max(0, runStart - PRECURSOR_POINTS), runStart)
    .map((point) => ({
      t: point.t,
      ok: point.ok,
      ms: Number.isFinite(point.ms) ? point.ms : 0,
      reason: point.reason ?? null,
    }));

  return { firstFailureAt, failureChecks, precursor };
}

/* ---------------- opening and closing ---------------- */

export interface OpenOptions {
  targetId: string;
  confirmedAt: string;
  result: ProbeResult;
  history: UptimeRecord[];
  vantage?: string | null;
}

export function openReport(options: OpenOptions): IncidentReport {
  const run = failureRunOf(options.history, options.confirmedAt);
  const firstMs = run.firstFailureAt ? Date.parse(run.firstFailureAt) : NaN;
  const confirmedMs = Date.parse(options.confirmedAt);

  return {
    id: options.confirmedAt,
    targetId: options.targetId,
    confirmedAt: options.confirmedAt,
    firstFailureAt: run.firstFailureAt,
    failureChecks: run.failureChecks,
    detectionMs: Number.isFinite(firstMs) && Number.isFinite(confirmedMs)
      ? Math.max(0, confirmedMs - firstMs)
      : null,
    firstSuccessAt: null,
    recoveredAt: null,
    durationMs: null,
    failure: snapshotOf(options.result),
    recovery: null,
    changed: [],
    precursor: run.precursor,
    vantage: options.vantage ?? null,
    alerts: null,
  };
}

/**
 * The first check that passed again, which is earlier than the confirmed recovery
 * whenever `recoveryThreshold` is above one.
 */
function firstSuccessIn(history: UptimeRecord[], recoveredAt: string): string | null {
  const points = Array.isArray(history) ? history : [];
  const end = points.findIndex((point) => point.t === recoveredAt);
  const upTo = end === -1 ? points : points.slice(0, end + 1);

  let firstSuccess: string | null = recoveredAt;
  for (let i = upTo.length - 1; i >= 0; i--) {
    const point = upTo[i]!;
    if (point.reason === 'disputed') continue;
    if (!point.ok) break;
    firstSuccess = point.t;
  }
  return firstSuccess;
}

export interface CloseOptions {
  recoveredAt: string;
  result: ProbeResult;
  history: UptimeRecord[];
}

export function closeReport(report: IncidentReport, options: CloseOptions): IncidentReport {
  const recovery = snapshotOf(options.result);
  const startedMs = Date.parse(report.confirmedAt);
  const endedMs = Date.parse(options.recoveredAt);

  return {
    ...report,
    firstSuccessAt: firstSuccessIn(options.history, options.recoveredAt),
    recoveredAt: options.recoveredAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, endedMs - startedMs)
      : null,
    recovery,
    changed: diffSnapshots(report.failure, recovery),
  };
}

/* ---------------- the log ---------------- */

export function openInLog(log: IncidentLog, options: OpenOptions): IncidentLog {
  // A second "down" without an intervening "up" must not start a duplicate, for
  // the same reason the summary incidents do not.
  if (log.reports.some((report) => report.recoveredAt === null)) return log;
  return {
    ...log,
    reports: [...log.reports, openReport(options)].slice(-REPORT_LIMIT),
  };
}

export function closeInLog(log: IncidentLog, options: CloseOptions): IncidentLog {
  const index = log.reports.findIndex((report) => report.recoveredAt === null);
  if (index === -1) return log;
  const reports = [...log.reports];
  reports[index] = closeReport(reports[index]!, options);
  return { ...log, reports };
}

/** Attach the delivery result once the fan-out has run. */
export function attachAlerts(
  log: IncidentLog,
  id: string,
  alerts: { attempted: number; delivered: number; failed: number },
): IncidentLog {
  const index = log.reports.findIndex((report) => report.id === id);
  if (index === -1) return log;
  const reports = [...log.reports];
  reports[index] = { ...reports[index]!, alerts };
  return { ...log, reports };
}

/** The open incident, if there is one. */
export function openReportOf(log: IncidentLog): IncidentReport | null {
  return log.reports.find((report) => report.recoveredAt === null) ?? null;
}
