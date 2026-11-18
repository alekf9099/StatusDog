import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  addMonitor,
  checkMembers,
  emptyDoc,
  MEMBER_LIMIT,
  memberKey,
  MemberError,
  readAccount,
  recordResult,
  removeMonitor,
  TOTAL_LIMIT,
  writeAccount,
  type MemberDoc,
  type MemberIndex,
  type MemberMonitor,
} from '../src/store/members.js';
import type { KvClient } from '../src/store/kv.js';
import type { ProbeResult } from '../src/config/types.js';
import { createSession, identify, loginConfigured, authorize, SESSION_COOKIE } from '../src/auth/session.js';

const SECRET = 'a-session-secret-for-tests-only';

/** A store with no MGET/MSET, like the simplest fake, to prove the fallbacks. */
function memoryKv(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    origin: 'memory',
    async get(key) { return data.get(key) ?? null; },
    async set(key, value) { data.set(key, value); },
    async del(key) { data.delete(key); },
  };
}

function result(ok: boolean, at = '2026-11-18T00:00:00.000Z'): ProbeResult {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    ok,
    status: ok ? 200 : 503,
    responseTimeMs: 120,
    redirects: 0,
    checkedAt: at,
    reason: ok ? null : 'status',
    message: ok ? null : 'Expected 2xx, got 503',
    detail: null,
  } as ProbeResult;
}

/* ---------- accounts ---------- */

test('an account key is stable, private, and not the address', () => {
  const a = memberKey('Someone@Example.com', SECRET);
  assert.equal(a, memberKey('someone@example.com', SECRET), 'case does not matter');
  assert.notEqual(a, memberKey('someone@example.com', 'another-secret'));
  assert.ok(!a.includes('example'), 'the address is not in the key');
});

test('adding: a clean address goes in, as a website or an API with its codes', () => {
  const key = memberKey('a@example.com', SECRET);
  let doc = emptyDoc();
  let index: MemberIndex = {};
  ({ doc, index } = addMonitor(doc, index, key, { url: 'example.com', name: '  My  site ' }));
  ({ doc, index } = addMonitor(doc, index, key, { url: 'https://api.example.com/health', type: 'api', expect: '2XX, 401' }));
  assert.equal(doc.monitors[0]!.url, 'https://example.com/');
  assert.equal(doc.monitors[0]!.type, 'web');
  assert.equal(doc.monitors[0]!.name, 'My site');
  assert.equal(doc.monitors[1]!.expect, '2xx,401');
  assert.equal(index[key], 2);
});

test('adding refuses private addresses, nonsense codes and duplicates', () => {
  const key = memberKey('a@example.com', SECRET);
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err instanceof MemberError ? err.code : 'other';
    }
    return null;
  };
  assert.equal(code(() => addMonitor(emptyDoc(), {}, key, { url: 'http://127.0.0.1/' })), 'invalid-url');
  assert.equal(code(() => addMonitor(emptyDoc(), {}, key, { url: 'http://192.168.0.1/admin' })), 'invalid-url');
  assert.equal(code(() => addMonitor(emptyDoc(), {}, key, { url: 'https://api.example.com/', type: 'api', expect: 'ok' })), 'invalid-expect');
  const { doc, index } = addMonitor(emptyDoc(), {}, key, { url: 'https://example.com/' });
  assert.equal(code(() => addMonitor(doc, index, key, { url: 'example.com' })), 'duplicate');
});

test('an account holds at most its limit, and everyone together at most theirs', () => {
  const key = memberKey('a@example.com', SECRET);
  let doc = emptyDoc();
  let index: MemberIndex = {};
  for (let i = 0; i < MEMBER_LIMIT; i++) ({ doc, index } = addMonitor(doc, index, key, { url: `https://site${i}.example.com/` }));
  assert.throws(() => addMonitor(doc, index, key, { url: 'https://one-more.example.com/' }), /up to/);

  const crowded: MemberIndex = { other: TOTAL_LIMIT };
  assert.throws(
    () => addMonitor(emptyDoc(), crowded, memberKey('b@example.com', SECRET), { url: 'https://example.com/' }),
    (err: unknown) => err instanceof MemberError && err.code === 'total-limit',
  );
});

test('removing one frees its place; removing the last drops the account from the index', () => {
  const key = memberKey('a@example.com', SECRET);
  const added = addMonitor(emptyDoc(), {}, key, { url: 'https://example.com/' }, new Date(), 'abc');
  const { doc, index } = removeMonitor(added.doc, added.index, key, 'abc');
  assert.equal(doc.monitors.length, 0);
  assert.equal(index[key], undefined);
  assert.throws(() => removeMonitor(doc, index, key, 'abc'), MemberError);
});

/* ---------- checks ---------- */

test('down after two failures in a row, up on the first success, with history kept short', () => {
  const key = memberKey('a@example.com', SECRET);
  let monitor: MemberMonitor = addMonitor(emptyDoc(), {}, key, { url: 'https://example.com/' }).monitor;
  monitor = recordResult(monitor, result(false, 't1'));
  assert.equal(monitor.state, 'unknown', 'one failure is not an outage');
  monitor = recordResult(monitor, result(false, 't2'));
  assert.equal(monitor.state, 'down');
  assert.equal(monitor.since, 't2');
  monitor = recordResult(monitor, result(true, 't3'));
  assert.equal(monitor.state, 'up');
  assert.equal(monitor.consecutiveFailures, 0);
  for (let i = 0; i < 100; i++) monitor = recordResult(monitor, result(true, `x${i}`));
  assert.equal(monitor.history.length, 48);
});

test('the scheduler checks everyone and keeps a list someone changed meanwhile', async () => {
  const kv = memoryKv();
  const keyA = memberKey('a@example.com', SECRET);
  const keyB = memberKey('b@example.com', SECRET);
  let { doc, index } = addMonitor(emptyDoc(), {}, keyA, { url: 'https://a.example.com/' }, new Date(), 'a1');
  await writeAccount(kv, keyA, doc, index);
  ({ doc, index } = addMonitor(emptyDoc(), index, keyB, { url: 'https://b.example.com/' }, new Date(), 'b1'));
  await writeAccount(kv, keyB, doc, index);

  const summary = await checkMembers(kv, async (monitor) => {
    // While B's check runs, B adds a second monitor.
    if (monitor.id === 'b1') {
      const current = await readAccount(kv, keyB);
      const next = addMonitor(current.doc, current.index, keyB, { url: 'https://b2.example.com/' }, new Date(), 'b2');
      await writeAccount(kv, keyB, next.doc, next.index);
    }
    return result(true);
  }, { deadline: Date.now() + 10_000 });

  assert.deepEqual(summary, { accounts: 2, monitors: 2, checked: 2, deferred: 0 });
  const a = JSON.parse(kv.data.get(keyA)!) as MemberDoc;
  const b = JSON.parse(kv.data.get(keyB)!) as MemberDoc;
  assert.equal(a.monitors[0]!.state, 'up');
  assert.deepEqual(b.monitors.map((monitor) => monitor.id), ['b1', 'b2'], 'the new monitor survived the write');
  assert.equal(b.monitors[0]!.state, 'up');
});

test('past its deadline the scheduler leaves the rest for the next run', async () => {
  const kv = memoryKv();
  const key = memberKey('a@example.com', SECRET);
  let doc = emptyDoc();
  let index: MemberIndex = {};
  for (let i = 0; i < 3; i++) ({ doc, index } = addMonitor(doc, index, key, { url: `https://s${i}.example.com/` }));
  await writeAccount(kv, key, doc, index);
  const summary = await checkMembers(kv, async () => result(true), { deadline: Date.now() - 1 });
  assert.equal(summary.checked, 0);
  assert.equal(summary.deferred, 3);
});

test('with nobody signed up, a run costs one read', async () => {
  let reads = 0;
  const kv = memoryKv();
  const counting: KvClient = { ...kv, async get(key) { reads++; return kv.get(key); } };
  const summary = await checkMembers(counting, async () => result(true), { deadline: Date.now() + 1000 });
  assert.equal(summary.accounts, 0);
  assert.equal(reads, 1);
});

/* ---------- sign-in ---------- */

const ENV = {
  STATUSDOG_SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  STATUSDOG_ADMIN_EMAILS: 'owner@example.com',
};

test('anyone can be signed in; only the allowlist is an owner', () => {
  const cookie = (email: string) => `${SESSION_COOKIE}=${encodeURIComponent(createSession(email, SECRET))}`;
  assert.equal(identify(cookie('someone@gmail.com'), ENV), 'someone@gmail.com');
  assert.equal(authorize(cookie('someone@gmail.com'), ENV).ok, false, 'signed in is not an owner');
  assert.equal(authorize(cookie('owner@example.com'), ENV).ok, true);
  assert.equal(identify('', ENV), null);
  assert.equal(identify(cookie('someone@gmail.com'), { ...ENV, GOOGLE_CLIENT_SECRET: '' }), null, 'no sign-in when it is not configured');
  assert.ok(loginConfigured({ ...ENV, STATUSDOG_ADMIN_EMAILS: '' }), 'sign-in does not need an owner list');
});

/* ---------- the endpoint, against a stand-in for the Upstash REST API ---------- */

async function fakeUpstash() {
  const data = new Map<string, string>();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const [cmd, ...args] = JSON.parse(body) as string[];
      let result: unknown = null;
      if (cmd === 'GET') result = data.get(args[0]!) ?? null;
      else if (cmd === 'SET') { data.set(args[0]!, args[1]!); result = 'OK'; }
      else if (cmd === 'MGET') result = args.map((key) => data.get(key) ?? null);
      else if (cmd === 'MSET') { for (let i = 0; i < args.length; i += 2) data.set(args[i]!, args[i + 1]!); result = 'OK'; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { data, url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function call(handler: (req: unknown, res: unknown) => Promise<void>, { method = 'GET', body = null as unknown, cookie = '', origin = 'http://localhost:3000', header = true } = {}) {
  const payload = body === null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = {
    method,
    url: '/api/auth?action=monitors',
    headers: {
      host: 'localhost:3000',
      cookie,
      origin,
      ...(header ? { 'x-statusdog-admin': '1' } : {}),
    },
    async *[Symbol.asyncIterator]() { yield* payload; },
  };
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve) => {
    let status = 200;
    const res = {
      setHeader() {},
      status(code: number) { status = code; return res; },
      json(value: Record<string, unknown>) { resolve({ status, json: value }); },
      end() { resolve({ status, json: {} }); },
    };
    void handler(req, res);
  });
}

test('the endpoint: sign-in required, same-site writes only, limits enforced', async () => {
  const upstash = await fakeUpstash();
  const saved = { ...process.env };
  Object.assign(process.env, ENV, { KV_REST_API_URL: upstash.url, KV_REST_API_TOKEN: 'token' });
  try {
    const { default: handler } = await import('../api/auth.js') as { default: (req: unknown, res: unknown) => Promise<void> };
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession('someone@gmail.com', SECRET))}`;

    assert.equal((await call(handler)).status, 401, 'signed out');
    const empty = await call(handler, { cookie });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.monitors, []);

    const crossSite = await call(handler, { method: 'POST', cookie, body: { op: 'add', url: 'example.com' }, origin: 'https://evil.example' });
    assert.equal(crossSite.status, 403);
    const noHeader = await call(handler, { method: 'POST', cookie, body: { op: 'add', url: 'example.com' }, header: false });
    assert.equal(noHeader.status, 403);

    const added = await call(handler, { method: 'POST', cookie, body: { op: 'add', url: 'example.com', type: 'web' } });
    assert.equal(added.status, 200);
    assert.equal((added.json.monitors as unknown[]).length, 1);
    const duplicate = await call(handler, { method: 'POST', cookie, body: { op: 'add', url: 'https://example.com/' } });
    assert.equal(duplicate.status, 409);
    const internal = await call(handler, { method: 'POST', cookie, body: { op: 'add', url: 'http://10.0.0.1/' } });
    assert.equal(internal.status, 400);

    const imported = await call(handler, {
      method: 'POST',
      cookie,
      body: { op: 'import', items: Array.from({ length: 6 }, (_, i) => ({ url: `https://i${i}.example.com/` })) },
    });
    const results = imported.json.results as Array<{ ok: boolean; code?: string }>;
    assert.equal(results.filter((r) => r.ok).length, MEMBER_LIMIT - 1, 'up to the limit');
    assert.equal(results.filter((r) => r.code === 'member-limit').length, 7 - MEMBER_LIMIT);

    // Nothing in the store says who this is.
    for (const value of upstash.data.values()) assert.ok(!value.includes('someone@gmail.com'));
  } finally {
    process.env = saved;
    await upstash.close();
  }
});
