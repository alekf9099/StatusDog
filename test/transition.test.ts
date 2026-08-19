import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProbeResult } from '../src/config/types.js';
import { applyResult, INITIAL_STATE, type StateSnapshot } from '../src/monitor/transition.js';

function result(ok: boolean, checkedAt = '2026-08-19T00:00:00.000Z'): ProbeResult {
  return {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    ok,
    status: ok ? 200 : 500,
    responseTimeMs: 10,
    redirects: 0,
    checkedAt,
    reason: ok ? null : 'status',
    message: ok ? null : 'Unexpected status 500',
    detail: null,
  };
}

const thresholds = { failureThreshold: 2, recoveryThreshold: 1 };

test('a first success moves unknown to up', () => {
  const { next, transitioned } = applyResult(INITIAL_STATE, result(true, 'T1'), thresholds);
  assert.equal(next.state, 'up');
  assert.equal(next.since, 'T1');
  assert.equal(transitioned, true);
  assert.equal(next.consecutiveSuccesses, 1);
  assert.equal(next.consecutiveFailures, 0);
});

test('one failure is not enough to go down', () => {
  const up: StateSnapshot = { state: 'up', since: 'T1', consecutiveFailures: 0, consecutiveSuccesses: 1 };
  const { next, transitioned } = applyResult(up, result(false, 'T2'), thresholds);
  assert.equal(next.state, 'up');
  assert.equal(transitioned, false);
  assert.equal(next.consecutiveFailures, 1);
  assert.equal(next.since, 'T1', 'since is untouched without a transition');
});

test('the second consecutive failure trips the threshold', () => {
  let state = { state: 'up', since: 'T1', consecutiveFailures: 0, consecutiveSuccesses: 1 } as StateSnapshot;
  state = applyResult(state, result(false, 'T2'), thresholds).next;
  const { next, transitioned } = applyResult(state, result(false, 'T3'), thresholds);
  assert.equal(next.state, 'down');
  assert.equal(transitioned, true);
  assert.equal(next.since, 'T3');
});

test('a success resets the failure streak', () => {
  let state = INITIAL_STATE;
  state = applyResult(state, result(false, 'T1'), thresholds).next;
  state = applyResult(state, result(true, 'T2'), thresholds).next;
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.state, 'up');

  state = applyResult(state, result(false, 'T3'), thresholds).next;
  assert.equal(state.state, 'up', 'the earlier failure does not count toward the threshold');
});

test('recoveryThreshold above one delays coming back up', () => {
  const slow = { failureThreshold: 1, recoveryThreshold: 3 };
  let state = applyResult(INITIAL_STATE, result(false, 'T1'), slow).next;
  assert.equal(state.state, 'down');

  state = applyResult(state, result(true, 'T2'), slow).next;
  assert.equal(state.state, 'down');
  state = applyResult(state, result(true, 'T3'), slow).next;
  assert.equal(state.state, 'down');

  const final = applyResult(state, result(true, 'T4'), slow);
  assert.equal(final.next.state, 'up');
  assert.equal(final.transitioned, true);
  assert.equal(final.next.since, 'T4');
});

test('staying down does not report a transition', () => {
  const down: StateSnapshot = { state: 'down', since: 'T1', consecutiveFailures: 5, consecutiveSuccesses: 0 };
  const { next, transitioned } = applyResult(down, result(false, 'T9'), thresholds);
  assert.equal(transitioned, false);
  assert.equal(next.since, 'T1');
  assert.equal(next.consecutiveFailures, 6);
});
