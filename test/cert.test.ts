import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  certSeverity,
  describeCertExpiry,
  evaluateCertExpiry,
  EMPTY_CERT_STATE,
  type CertNotifyState,
} from '../src/monitor/cert.js';
import type { TlsInfo } from '../src/config/types.js';
import { resolveConfig } from '../src/config/index.js';

const THRESHOLDS = [30, 14, 7, 3, 1];

function cert(daysRemaining: number | null, validTo = 'Oct 27 22:17:21 2026 GMT'): TlsInfo {
  return {
    subject: '*.example.com',
    issuer: 'DigiCert Inc',
    validFrom: 'Jul  1 00:00:00 2026 GMT',
    validTo,
    daysRemaining,
    protocol: 'TLSv1.3',
  };
}

/* ---------------- nothing to say ---------------- */

test('a certificate with plenty of time left produces no warning', () => {
  const result = evaluateCertExpiry(cert(69), THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(result.crossed, null);
  assert.equal(result.daysRemaining, 69);
  assert.equal(result.expired, false);
});

test('an http target is not a certificate problem', () => {
  const result = evaluateCertExpiry(null, THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(result.crossed, null);
  assert.equal(result.daysRemaining, null);
});

test('a probe that failed before the handshake does not wipe the stored state', () => {
  // One network blip must not look like a renewal and re-arm every warning.
  const stored: CertNotifyState = { validTo: 'Oct 27 2026', notifiedDays: [30, 14] };
  const result = evaluateCertExpiry(null, THRESHOLDS, stored);
  assert.deepEqual(result.state, stored);
  assert.equal(result.renewed, false);
});

test('warnings can be turned off with an empty threshold list', () => {
  const result = evaluateCertExpiry(cert(1), [], EMPTY_CERT_STATE);
  assert.equal(result.crossed, null);
});

/* ---------------- warning once per threshold ---------------- */

test('crossing a threshold warns once, not every fifteen minutes', () => {
  const first = evaluateCertExpiry(cert(29), THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(first.crossed, 30, 'the 30-day threshold is the one crossed');

  const second = evaluateCertExpiry(cert(28), THRESHOLDS, first.state);
  assert.equal(second.crossed, null, 'already warned about this certificate');

  const third = evaluateCertExpiry(cert(20), THRESHOLDS, second.state);
  assert.equal(third.crossed, null);
});

test('each tighter threshold gets its own warning', () => {
  let state = EMPTY_CERT_STATE;
  const warned: number[] = [];
  for (const days of [40, 29, 20, 13, 10, 6, 4, 2, 1, 0]) {
    const result = evaluateCertExpiry(cert(days), THRESHOLDS, state);
    state = result.state;
    if (result.crossed !== null) warned.push(result.crossed);
  }
  assert.deepEqual(warned, [30, 14, 7, 3, 1], 'one warning per threshold, in order');
});

test('a renewal clears the warnings so the next expiry warns again', () => {
  const warned = evaluateCertExpiry(cert(5, 'old-cert'), THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(warned.crossed, 7);
  assert.deepEqual(warned.state.notifiedDays, [7, 14, 30], "only the crossed thresholds are recorded");

  const renewed = evaluateCertExpiry(cert(90, 'new-cert'), THRESHOLDS, warned.state);
  assert.equal(renewed.renewed, true);
  assert.equal(renewed.crossed, null, 'ninety days is nothing to warn about');
  assert.deepEqual(renewed.state.notifiedDays, [], 'the slate is clean for the new certificate');

  const later = evaluateCertExpiry(cert(29, 'new-cert'), THRESHOLDS, renewed.state);
  assert.equal(later.crossed, 30, 'the new certificate warns on its own schedule');
});

test('a renewal that is already short warns about the tightest threshold', () => {
  const stale: CertNotifyState = { validTo: 'old-cert', notifiedDays: [30, 14, 7, 3, 1] };
  const result = evaluateCertExpiry(cert(10, 'new-cert'), THRESHOLDS, stale);
  assert.equal(result.renewed, true);
  assert.equal(result.crossed, 14, 'not 30 — the useful number is the tight one');
});

test('an expired certificate is reported as expired, not as "0 days left"', () => {
  const result = evaluateCertExpiry(cert(-3), THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(result.expired, true);
  assert.equal(result.crossed, 1, 'every threshold is crossed; the tightest is reported');
  assert.equal(certSeverity(result), 'critical');
});

/* ---------------- state hygiene ---------------- */

test('a corrupt stored state is tolerated', () => {
  const result = evaluateCertExpiry(
    cert(29),
    THRESHOLDS,
    { validTo: null, notifiedDays: ['30', null, 14] as unknown as number[] },
  );
  assert.equal(result.crossed, 30, 'the unusable entries are dropped, not trusted');
  assert.ok(result.state.notifiedDays.every((day) => typeof day === 'number'));
});

test('duplicate and unsorted thresholds are handled', () => {
  const result = evaluateCertExpiry(cert(6), [7, 30, 7, 14], EMPTY_CERT_STATE);
  assert.equal(result.crossed, 7);
  assert.deepEqual(result.state.notifiedDays, [7, 14, 30]);
});

test('the first sighting of a certificate does not count as a renewal', () => {
  const result = evaluateCertExpiry(cert(50), THRESHOLDS, EMPTY_CERT_STATE);
  assert.equal(result.renewed, false);
  assert.equal(result.state.validTo, 'Oct 27 22:17:21 2026 GMT');
});

/* ---------------- severity and wording ---------------- */

test('severity tightens as the date approaches', () => {
  const at = (days: number) => certSeverity(evaluateCertExpiry(cert(days), THRESHOLDS, EMPTY_CERT_STATE));
  assert.equal(at(29), 'warning');
  assert.equal(at(14), 'warning');
  assert.equal(at(7), 'critical');
  assert.equal(at(1), 'critical');
});

test('the summary line names the site and the number of days', () => {
  const target = { name: 'CopyKiller', url: 'https://www.copykiller.com/' };

  const soon = describeCertExpiry(target, evaluateCertExpiry(cert(13), THRESHOLDS, EMPTY_CERT_STATE));
  assert.match(soon, /expires in 13 day/);
  assert.match(soon, /CopyKiller/);
  assert.match(soon, /copykiller\.com/);

  const gone = describeCertExpiry(target, evaluateCertExpiry(cert(-2), THRESHOLDS, EMPTY_CERT_STATE));
  assert.match(gone, /EXPIRED 2 day/, 'an expired cert reads as expired, not "-2 days"');
});

/* ---------------- config ---------------- */

test('certExpiryWarnDays has a sensible default and can be overridden', () => {
  const defaulted = resolveConfig({ targets: [{ id: 'a', url: 'https://example.com' }] }).targets[0]!;
  assert.deepEqual(defaulted.certExpiryWarnDays, [1, 3, 7, 14, 30]);

  const custom = resolveConfig({
    targets: [{ id: 'a', url: 'https://example.com', certExpiryWarnDays: [60, 10] }],
  }).targets[0]!;
  assert.deepEqual(custom.certExpiryWarnDays, [10, 60], 'stored sorted, so evaluation is predictable');

  const off = resolveConfig({
    targets: [{ id: 'a', url: 'https://example.com', certExpiryWarnDays: [] }],
  }).targets[0]!;
  assert.deepEqual(off.certExpiryWarnDays, [], 'an empty list is a valid "off"');
});

test('a nonsensical threshold list is rejected at config load', () => {
  assert.throws(
    () => resolveConfig({ targets: [{ id: 'a', url: 'https://example.com', certExpiryWarnDays: [-1] }] }),
    /non-negative/,
  );
  assert.throws(
    () => resolveConfig({
      targets: [{ id: 'a', url: 'https://example.com', certExpiryWarnDays: ['soon'] as unknown as number[] }],
    }),
    /non-negative/,
  );
});
