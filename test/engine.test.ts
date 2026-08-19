import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolveConfig } from '../src/config/index.js';
import { Monitor } from '../src/monitor/engine.js';
import { HistoryStore } from '../src/monitor/store.js';
import { createFallbackMiddleware } from '../src/fallback/middleware.js';
import { startTestServer } from './helpers.js';

let healthy = true;

const server = await startTestServer((_req, res) => {
  res.writeHead(healthy ? 200 : 500);
  res.end(healthy ? 'ok' : 'down');
});

after(() => server.close());

function buildMonitor(overrides: Record<string, unknown> = {}) {
  const config = resolveConfig({
    targets: [
      {
        id: 'app',
        name: 'App',
        url: server.url,
        expectStatus: ['2xx'],
        failureThreshold: 2,
        recoveryThreshold: 1,
        ...overrides,
      },
    ],
    storage: { file: null, historyLimit: 50 },
    notifiers: [],
  });
  // Keep history in memory so tests never touch the disk.
  return new Monitor(config, new HistoryStore(null, 50));
}

test('failureThreshold delays the down transition', async () => {
  const monitor = buildMonitor();
  const transitions: string[] = [];
  monitor.on('down', (e) => transitions.push(`down:${e.from}`));
  monitor.on('up', (e) => transitions.push(`up:${e.from}`));

  healthy = true;
  await monitor.check('app');
  assert.equal(monitor.getStatus('app')?.state, 'up');
  assert.deepEqual(transitions, ['up:unknown']);

  healthy = false;
  await monitor.check('app');
  assert.equal(monitor.getStatus('app')?.state, 'up', 'one failure is not enough');

  await monitor.check('app');
  assert.equal(monitor.getStatus('app')?.state, 'down');
  assert.deepEqual(transitions, ['up:unknown', 'down:up']);

  healthy = true;
  await monitor.check('app');
  assert.equal(monitor.getStatus('app')?.state, 'up');
  assert.deepEqual(transitions, ['up:unknown', 'down:up', 'up:down']);
});

test('history and stats accumulate', async () => {
  const monitor = buildMonitor();
  healthy = true;
  await monitor.check('app');
  healthy = false;
  await monitor.check('app');
  await monitor.check('app');

  const history = monitor.history('app');
  assert.equal(history.length, 3);
  const stats = monitor.getStatus('app')!.stats;
  assert.equal(stats.checks, 3);
  assert.equal(stats.failures, 2);
  assert.equal(stats.uptimePct, 33.33);
});

test('concurrent checks share a single probe', async () => {
  const monitor = buildMonitor();
  healthy = true;
  const [a, b] = await Promise.all([monitor.check('app'), monitor.check('app')]);
  assert.equal(a.checkedAt, b.checkedAt);
  assert.equal(monitor.history('app').length, 1);
});

test('unknown targets are rejected', async () => {
  const monitor = buildMonitor();
  await assert.rejects(() => monitor.check('nope'), /Unknown target "nope"/);
});

test('the middleware only intercepts once the target is confirmed down', async () => {
  const monitor = buildMonitor();
  const middleware = createFallbackMiddleware(monitor, {
    targetId: 'app',
    allowPaths: ['/healthz'],
  });

  const run = (url: string) => {
    const chunks: string[] = [];
    let statusCode = 0;
    let nextCalled = false;
    const res = {
      writeHead(code: number) { statusCode = code; return this; },
      end(body?: string) { if (body) chunks.push(body); },
    };
    middleware({ url, method: 'GET' } as never, res as never, () => { nextCalled = true; });
    return { statusCode, body: chunks.join(''), nextCalled };
  };

  healthy = false;
  await monitor.check('app');
  assert.equal(run('/').nextCalled, true, 'still within the failure threshold');

  await monitor.check('app');
  const blocked = run('/');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 503);
  assert.match(blocked.body, /Served by StatusDog/);

  assert.equal(run('/healthz').nextCalled, true, 'allowPaths stay live');

  healthy = true;
  await monitor.check('app');
  assert.equal(run('/').nextCalled, true, 'traffic resumes after recovery');
});
