import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config/index.js';
import type { ProbeResult, ResolvedTarget } from '../src/config/types.js';
import { createKvClient, kvFromEnv, KvError, type KvClient } from '../src/store/kv.js';
import { applyCheck, HISTORY_LIMIT, readAll, readEntry, statsFor } from '../src/store/uptime.js';
import { resolveRoster } from '../src/store/roster.js';

/** In-memory stand-in with the same contract as the REST client. */
function fakeKv(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    origin: 'memory',
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

function target(overrides: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const config = resolveConfig({
    targets: [{ id: 'api', name: 'API', url: 'https://example.com', failureThreshold: 2, recoveryThreshold: 1 }],
  });
  return { ...config.targets[0]!, ...overrides };
}

function result(ok: boolean, checkedAt: string, ms = 42): ProbeResult {
  return {
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    ok,
    status: ok ? 200 : 503,
    responseTimeMs: ms,
    redirects: 0,
    checkedAt,
    reason: ok ? null : 'status',
    message: ok ? null : 'Unexpected status 503',
    detail: null,
  };
}

/* ---------------- kv client ---------------- */

test('kvFromEnv returns null when nothing is configured', () => {
  assert.equal(kvFromEnv({}), null);
  assert.equal(kvFromEnv({ KV_REST_API_URL: 'https://kv.example' }), null, 'url alone is not enough');
});

test('kvFromEnv recognises each supported credential pair', () => {
  assert.ok(kvFromEnv({ KV_REST_API_URL: 'https://a.example', KV_REST_API_TOKEN: 't' }));
  assert.ok(kvFromEnv({ UPSTASH_REDIS_REST_URL: 'https://b.example', UPSTASH_REDIS_REST_TOKEN: 't' }));
  assert.ok(kvFromEnv({ REDIS_REST_URL: 'https://c.example', REDIS_REST_TOKEN: 't' }));
});

test('the client speaks the Redis REST command protocol', async () => {
  const calls: Array<{ body: unknown; auth: string | undefined }> = [];
  const kv = createKvClient({
    url: 'https://kv.example/',
    token: 'secret-token',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      calls.push({
        body: JSON.parse(String(init.body)),
        auth: new Headers(init.headers).get('authorization') ?? undefined,
      });
      return new Response(JSON.stringify({ result: 'stored-value' }), { status: 200 });
    }) as unknown as typeof fetch,
  });

  assert.equal(await kv.get('k'), 'stored-value');
  await kv.set('k', 'v');
  await kv.del('k');

  assert.deepEqual(calls.map((c) => c.body), [['GET', 'k'], ['SET', 'k', 'v'], ['DEL', 'k']]);
  assert.equal(calls[0]!.auth, 'Bearer secret-token');
  assert.equal(kv.origin, 'https://kv.example', 'origin never carries the token');
});

test('a null result reads as a missing key', async () => {
  const kv = createKvClient({
    url: 'https://kv.example',
    token: 't',
    fetchImpl: (async () => new Response(JSON.stringify({ result: null }), { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(await kv.get('missing'), null);
});

test('transport and protocol failures surface as KvError', async () => {
  const rejecting = createKvClient({
    url: 'https://kv.example',
    token: 't',
    fetchImpl: (async () => { throw new Error('socket hang up'); }) as unknown as typeof fetch,
  });
  await assert.rejects(() => rejecting.get('k'), KvError);

  const failing = createKvClient({
    url: 'https://kv.example',
    token: 't',
    fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
  });
  await assert.rejects(() => failing.get('k'), /returned 401/);
});

/* ---------------- uptime store ---------------- */

test('a missing key reads as a blank entry', async () => {
  const kv = fakeKv();
  const entry = await readEntry(kv, target());
  assert.equal(entry.state, 'unknown');
  assert.equal(entry.lastResult, null);
  assert.deepEqual(entry.history, []);
});

test('applyCheck persists state and history across calls', async () => {
  const kv = fakeKv();
  const t = target();

  let applied = await applyCheck(kv, t, result(true, 'T1'));
  assert.equal(applied.entry.state, 'up');
  assert.equal(applied.transitioned, true);

  applied = await applyCheck(kv, t, result(false, 'T2'));
  assert.equal(applied.entry.state, 'up', 'one failure is below the threshold');
  assert.equal(applied.transitioned, false);

  applied = await applyCheck(kv, t, result(false, 'T3'));
  assert.equal(applied.entry.state, 'down');
  assert.equal(applied.transitioned, true);

  const reread = await readEntry(kv, t);
  assert.equal(reread.state, 'down');
  assert.equal(reread.history.length, 3);
  assert.equal(reread.lastResult?.checkedAt, 'T3');
});

test('history is capped and keeps the newest records', async () => {
  const kv = fakeKv();
  const t = target();
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
    await applyCheck(kv, t, result(true, `T${i}`));
  }
  const entry = await readEntry(kv, t);
  assert.equal(entry.history.length, HISTORY_LIMIT);
  assert.equal(entry.history.at(-1)?.t, `T${HISTORY_LIMIT + 24}`);
  assert.equal(entry.history[0]?.t, 'T25', 'the oldest records were dropped');
});

test('stats summarise the retained history', async () => {
  const kv = fakeKv();
  const t = target();
  await applyCheck(kv, t, result(true, 'T1', 100));
  await applyCheck(kv, t, result(false, 'T2', 200));
  await applyCheck(kv, t, result(true, 'T3', 300));

  const stats = statsFor(await readEntry(kv, t));
  assert.equal(stats.checks, 3);
  assert.equal(stats.failures, 1);
  assert.equal(stats.uptimePct, 66.67);
  assert.equal(stats.avgResponseTimeMs, 200);
  assert.equal(stats.lastCheckedAt, 'T3');
});

test('a corrupt stored value degrades to blank instead of throwing', async () => {
  const kv = fakeKv();
  const t = target();
  await applyCheck(kv, t, result(true, 'T1'));
  kv.data.set([...kv.data.keys()][0]!, '{not json');

  const entry = await readEntry(kv, t);
  assert.equal(entry.state, 'unknown');
  assert.deepEqual(entry.history, []);
});

test('the roster is the source of truth for name and url', async () => {
  const kv = fakeKv();
  await applyCheck(kv, target(), result(true, 'T1'));

  const renamed = await readEntry(kv, target({ name: 'Renamed API', url: 'https://new.example/' }));
  assert.equal(renamed.name, 'Renamed API');
  assert.equal(renamed.url, 'https://new.example/');
  assert.equal(renamed.state, 'up', 'stored state survives the rename');
});

test('readAll returns entries in roster order', async () => {
  const kv = fakeKv();
  const a = target({ id: 'a', name: 'A' });
  const b = target({ id: 'b', name: 'B' });
  await applyCheck(kv, b, result(false, 'T1'));

  const entries = await readAll(kv, [a, b]);
  assert.deepEqual(entries.map((e) => e.id), ['a', 'b']);
  assert.equal(entries[0]!.history.length, 0);
  assert.equal(entries[1]!.history.length, 1);
});

/* ---------------- roster ---------------- */

test('resolveRoster validates and drops disabled targets', () => {
  const targets = resolveRoster({
    defaults: { expectStatus: ['2xx'] },
    targets: [
      { id: 'on', url: 'https://a.example' },
      { id: 'off', url: 'https://b.example', enabled: false },
    ],
  });
  assert.deepEqual(targets.map((t) => t.id), ['on']);
  assert.deepEqual(targets[0]!.expectStatus, ['2xx'], 'defaults are inherited');
});

test('resolveRoster rejects a malformed roster', () => {
  assert.throws(() => resolveRoster({ targets: [] }), /non-empty/);
  assert.throws(() => resolveRoster({ targets: [{ id: 'x', url: 'not-a-url' }] }), /invalid url/);
});

test('the committed monitors.json is valid', async () => {
  const { loadRoster } = await import('../src/store/roster.js');
  const targets = await loadRoster();
  assert.ok(targets.length > 0, 'monitors.json should list at least one target');
  for (const t of targets) {
    assert.match(t.url, /^https?:\/\//);
    assert.ok(t.timeoutMs > 0);
  }
});
