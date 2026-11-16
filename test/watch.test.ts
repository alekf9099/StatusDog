import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { troubleOf, troubleSignature, TROUBLE_LEVELS } = (await import(
  pathToFileURL(path.resolve('public/assets/office/mood.js')).href
)) as {
  troubleOf: (monitors: unknown[]) => Record<string, Array<{ id: string; name: string }>>;
  troubleSignature: (trouble: Record<string, Array<{ id: string }>>) => string;
  TROUBLE_LEVELS: string[];
};

const ok = (ms: number) => ({ ok: true, status: 200, responseTimeMs: ms });
const steady = (ms: number, n = 6) => Array.from({ length: n }, (_, i) => ({ t: `T${i}`, ok: true, ms }));

test('down, connection errors and slow answers each land in their own group', () => {
  const trouble = troubleOf([
    { id: 'a', name: 'A', state: 'down', lastResult: { ok: false, reason: 'timeout' }, history: [] },
    { id: 'b', name: 'B', state: 'up', lastResult: { ok: false, reason: 'network' }, consecutiveFailures: 1, history: [] },
    { id: 'c', name: 'C', state: 'up', lastResult: ok(900), history: [...steady(100), { t: 'now', ok: true, ms: 900 }] },
    { id: 'd', name: 'D', state: 'up', lastResult: ok(100), history: steady(100) },
  ]);
  assert.deepEqual(trouble.down.map((site) => site.id), ['a']);
  assert.deepEqual(trouble.failing.map((site) => site.id), ['b']);
  assert.deepEqual(trouble.slow.map((site) => site.id), ['c']);
});

test('a healthy roster, or one not checked yet, raises nothing', () => {
  const trouble = troubleOf([
    { id: 'a', state: 'up', lastResult: ok(100), history: steady(100) },
    { id: 'b', state: 'unknown', lastResult: null, history: [] },
  ]);
  for (const level of TROUBLE_LEVELS) assert.equal(trouble[level].length, 0);
});

test('the signature changes when the trouble does, and not with the order of the list', () => {
  const down = (id: string) => ({ id, state: 'down', lastResult: { ok: false }, history: [] });
  const one = troubleSignature(troubleOf([down('a'), down('b')]));
  assert.equal(troubleSignature(troubleOf([down('b'), down('a')])), one);
  assert.notEqual(troubleSignature(troubleOf([down('a')])), one);
});

test('every page carries the watch and can be installed', () => {
  for (const file of readdirSync('public').filter((name) => name.endsWith('.html'))) {
    const html = readFileSync(path.join('public', file), 'utf8');
    assert.ok(html.includes('src="/assets/watch.js"'), `${file} loads the watch`);
    assert.ok(html.includes('rel="manifest"'), `${file} links the manifest`);
  }
});

test('the service worker never caches the API', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return;/);
});
