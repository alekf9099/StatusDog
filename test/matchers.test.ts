import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyMatches, statusMatches } from '../src/monitor/matchers.js';

test('statusMatches handles exact codes', () => {
  assert.equal(statusMatches(200, [200]), true);
  assert.equal(statusMatches(201, [200]), false);
  assert.equal(statusMatches(204, ['204']), true);
});

test('statusMatches handles classes', () => {
  assert.equal(statusMatches(299, ['2xx']), true);
  assert.equal(statusMatches(301, ['2xx']), false);
  assert.equal(statusMatches(301, ['2xx', '3xx']), true);
  assert.equal(statusMatches(503, ['5XX']), true);
});

test('statusMatches handles ranges and wildcards', () => {
  assert.equal(statusMatches(250, ['200-299']), true);
  assert.equal(statusMatches(300, ['200-299']), false);
  assert.equal(statusMatches(299, ['299-200']), true, 'reversed ranges still work');
  assert.equal(statusMatches(418, ['*']), true);
});

test('statusMatches rejects nonsense expectations', () => {
  assert.equal(statusMatches(200, ['nope']), false);
  assert.equal(statusMatches(200, []), false);
});

test('bodyMatches supports substrings and regex', () => {
  assert.equal(bodyMatches('{"status":"ok"}', '"status":"ok"', false), true);
  assert.equal(bodyMatches('{"status":"ok"}', 'degraded', false), false);
  assert.equal(bodyMatches('build 1.2.3', '\\d+\\.\\d+\\.\\d+', true), true);
  assert.equal(bodyMatches('anything', '[unclosed', true), false, 'bad regex fails the check');
});
