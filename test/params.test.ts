import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIntParam } from '../src/util/params.js';

const opts = { min: 1_000, max: 30_000, fallback: 15_000 };

test('an absent parameter falls back to the default', () => {
  // The regression this guards: Number(null) is 0, not NaN, so the obvious
  // isFinite check clamped a missing parameter to the minimum instead.
  assert.equal(parseIntParam(null, opts), 15_000);
  assert.equal(parseIntParam(undefined, opts), 15_000);
});

test('a blank parameter falls back to the default', () => {
  assert.equal(parseIntParam('', opts), 15_000);
  assert.equal(parseIntParam('   ', opts), 15_000);
});

test('a non-numeric parameter falls back to the default', () => {
  assert.equal(parseIntParam('soon', opts), 15_000);
  assert.equal(parseIntParam('NaN', opts), 15_000);
  assert.equal(parseIntParam('12abc', opts), 15_000);
});

test('an explicit zero is honoured, not treated as absent', () => {
  assert.equal(parseIntParam('0', { min: 0, max: 480, fallback: 60 }), 0);
});

test('values are clamped to the range', () => {
  assert.equal(parseIntParam('500', opts), 1_000, 'below min');
  assert.equal(parseIntParam('999999', opts), 30_000, 'above max');
  assert.equal(parseIntParam('-5', opts), 1_000, 'negative');
});

test('values inside the range pass through, truncated', () => {
  assert.equal(parseIntParam('2500', opts), 2_500);
  assert.equal(parseIntParam('2500.9', opts), 2_500);
});

test('Infinity is rejected rather than clamped to max', () => {
  assert.equal(parseIntParam('Infinity', opts), 15_000);
  assert.equal(parseIntParam('-Infinity', opts), 15_000);
});
