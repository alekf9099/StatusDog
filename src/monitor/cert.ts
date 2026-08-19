import type { TlsInfo } from '../config/types.js';

/**
 * Certificate expiry warnings.
 *
 * The probe already reads `daysRemaining` on every check, and until now nothing
 * looked at it. A certificate running out is the one total outage that is
 * completely foreseeable, so it deserves warning long before it fails — by the
 * time the handshake breaks, the site is already down.
 *
 * The state below exists so a warning fires once per threshold rather than every
 * fifteen minutes for a month.
 */

export interface CertNotifyState {
  /** Identifies the certificate currently installed; a change means it was renewed. */
  validTo: string | null;
  /** Thresholds already warned about for *this* certificate. */
  notifiedDays: number[];
}

export const EMPTY_CERT_STATE: CertNotifyState = { validTo: null, notifiedDays: [] };

export interface CertEvaluation {
  /** The threshold to warn about now, or `null` when there is nothing new to say. */
  crossed: number | null;
  daysRemaining: number | null;
  expired: boolean;
  /** True when the certificate changed since the last check. */
  renewed: boolean;
  /** Persist this. */
  state: CertNotifyState;
}

const NOTHING: Omit<CertEvaluation, 'state'> = {
  crossed: null,
  daysRemaining: null,
  expired: false,
  renewed: false,
};

/**
 * Decide whether this check should produce an expiry warning.
 *
 * Pure: it takes the stored state and returns the next one, so the caller owns
 * persistence and this stays testable.
 */
export function evaluateCertExpiry(
  tls: TlsInfo | null | undefined,
  thresholds: number[],
  previous: CertNotifyState = EMPTY_CERT_STATE,
): CertEvaluation {
  const daysRemaining = tls && Number.isFinite(tls.daysRemaining as number)
    ? (tls.daysRemaining as number)
    : null;

  // A plain http target, or a probe that never got a certificate. Keep whatever
  // was stored rather than wiping it: one failed check is not a renewal.
  if (daysRemaining === null) {
    return { ...NOTHING, state: normalize(previous) };
  }

  const identity = tls?.validTo ?? null;
  const renewed = previous.validTo !== null && previous.validTo !== identity;
  const notified = renewed ? [] : normalize(previous).notifiedDays;

  const sorted = [...new Set(thresholds.filter((day) => Number.isFinite(day)))].sort((a, b) => a - b);
  const crossedAll = sorted.filter((day) => daysRemaining <= day);
  const fresh = crossedAll.filter((day) => !notified.includes(day));

  return {
    // Warn about the tightest threshold newly crossed: if a renewal lands with
    // ten days left, "10 days" is the useful number, not "30".
    crossed: fresh.length > 0 ? Math.min(...fresh) : null,
    daysRemaining,
    expired: daysRemaining < 0,
    renewed,
    state: {
      validTo: identity,
      notifiedDays: [...new Set([...notified, ...crossedAll])].sort((a, b) => a - b),
    },
  };
}

function normalize(state: CertNotifyState | null | undefined): CertNotifyState {
  return {
    validTo: state?.validTo ?? null,
    notifiedDays: Array.isArray(state?.notifiedDays)
      ? state.notifiedDays.filter((day): day is number => Number.isFinite(day))
      : [],
  };
}

/** One line for a chat client. Server-side alerts are English, like the others. */
export function describeCertExpiry(
  target: { name: string; url: string },
  evaluation: CertEvaluation,
): string {
  const days = evaluation.daysRemaining ?? 0;
  if (evaluation.expired) {
    return `TLS certificate EXPIRED ${Math.abs(days)} day(s) ago: ${target.name} (${target.url})`;
  }
  return `TLS certificate expires in ${days} day(s): ${target.name} (${target.url})`;
}

/** Warnings tighten as the date approaches, so the severity should too. */
export function certSeverity(evaluation: CertEvaluation): 'warning' | 'critical' {
  if (evaluation.expired) return 'critical';
  return (evaluation.daysRemaining ?? 99) <= 7 ? 'critical' : 'warning';
}
