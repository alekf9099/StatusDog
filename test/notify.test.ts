import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolveConfig } from '../src/config/index.js';
import type { ProbeResult, ResolvedTarget } from '../src/config/types.js';
import type { TransitionEvent } from '../src/monitor/transition.js';
import { createNotifier } from '../src/notify/index.js';
import {
  dispatchTransitions,
  notifierConfigsFromEnv,
  notifiersFromEnv,
} from '../src/notify/dispatch.js';
import { createLogger } from '../src/util/log.js';
import { startTestServer } from './helpers.js';

const silent = createLogger('silent');

function target(): ResolvedTarget {
  return resolveConfig({
    targets: [{ id: 'api', name: 'Public API', url: 'https://example.com/health' }],
  }).targets[0]!;
}

function result(ok: boolean): ProbeResult {
  return {
    url: 'https://example.com/health',
    finalUrl: 'https://example.com/health',
    ok,
    status: ok ? 200 : 503,
    responseTimeMs: 31,
    redirects: 0,
    checkedAt: '2026-08-19T07:00:00.000Z',
    reason: ok ? null : 'status',
    message: ok ? null : 'Unexpected status 503 (expected 2xx)',
    detail: null,
  };
}

function event(to: 'up' | 'down', from: 'up' | 'down' | 'unknown' = 'unknown'): TransitionEvent {
  return { target: target(), from, to, result: result(to === 'up'), at: '2026-08-19T07:00:00.000Z' };
}

/* ---------------- env configuration ---------------- */

test('no webhook env means no notifiers, which is not an error', () => {
  assert.deepEqual(notifierConfigsFromEnv({}), []);
  assert.deepEqual(notifiersFromEnv({}), []);
});

test('a comma-separated list becomes one notifier per URL', () => {
  const configs = notifierConfigsFromEnv({
    STATUSDOG_WEBHOOK_URL: 'https://a.example/hook, https://b.example/hook ',
  });
  assert.equal(configs.length, 2);
  assert.deepEqual(configs.map((c) => (c as { url: string }).url), [
    'https://a.example/hook',
    'https://b.example/hook',
  ]);
});

test('malformed and non-http URLs are dropped rather than throwing', () => {
  const configs = notifierConfigsFromEnv({
    STATUSDOG_WEBHOOK_URL: 'not-a-url, ftp://x.example, , https://ok.example/hook',
  });
  assert.equal(configs.length, 1);
  assert.equal((configs[0] as { url: string }).url, 'https://ok.example/hook');
});

test('STATUSDOG_WEBHOOK_ON restricts which transitions alert', () => {
  const only = notifierConfigsFromEnv({
    STATUSDOG_WEBHOOK_URL: 'https://a.example/hook',
    STATUSDOG_WEBHOOK_ON: 'down',
  });
  assert.deepEqual((only[0] as { on?: string[] }).on, ['down']);

  const both = notifierConfigsFromEnv({
    STATUSDOG_WEBHOOK_URL: 'https://a.example/hook',
    STATUSDOG_WEBHOOK_ON: 'up, DOWN',
  });
  assert.deepEqual((both[0] as { on?: string[] }).on, ['up', 'down']);

  const nonsense = notifierConfigsFromEnv({
    STATUSDOG_WEBHOOK_URL: 'https://a.example/hook',
    STATUSDOG_WEBHOOK_ON: 'sideways',
  });
  assert.equal((nonsense[0] as { on?: string[] }).on, undefined, 'falls back to both');
});

/* ---------------- webhook delivery ---------------- */

const received: Array<{ path: string; body: unknown; contentType: string | undefined }> = [];
let respondWith = 200;

const hook = await startTestServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    received.push({
      path: req.url ?? '/',
      body: body ? JSON.parse(body) : null,
      contentType: req.headers['content-type'],
    });
    res.writeHead(respondWith);
    res.end();
  });
});

after(() => hook.close());

test('the payload carries both text and content so Slack and Discord both work', async () => {
  received.length = 0;
  respondWith = 200;

  const notifier = createNotifier({ type: 'webhook', url: `${hook.url}/services/T000/B000` }, silent);
  await notifier.notify(event('down', 'up'));

  assert.equal(received.length, 1);
  const payload = received[0]!.body as Record<string, unknown>;
  assert.equal(received[0]!.path, '/services/T000/B000');
  assert.equal(payload.event, 'down');
  assert.equal(payload.previousState, 'up');
  assert.equal(
    payload.text,
    'Down: Public API (https://example.com/health) — Unexpected status 503 (expected 2xx)',
  );
  assert.equal(payload.content, payload.text, 'Discord reads content, Slack reads text');
  assert.deepEqual(payload.target, {
    id: 'api',
    name: 'Public API',
    url: 'https://example.com/health',
  });
});

test('the notifier name never leaks the webhook path', () => {
  const notifier = createNotifier(
    { type: 'webhook', url: `${hook.url}/services/SECRET-TOKEN-HERE` },
    silent,
  );
  assert.equal(notifier.name, `webhook(${hook.url})`);
  assert.ok(!notifier.name.includes('SECRET-TOKEN-HERE'));
});

test('a filtered-out transition sends nothing', async () => {
  received.length = 0;
  const notifier = createNotifier(
    { type: 'webhook', url: hook.url, on: ['down'] },
    silent,
  );
  await notifier.notify(event('up', 'down'));
  assert.equal(received.length, 0);

  await notifier.notify(event('down', 'up'));
  assert.equal(received.length, 1);
});

test('a non-2xx response rejects', async () => {
  received.length = 0;
  respondWith = 500;
  const notifier = createNotifier({ type: 'webhook', url: hook.url }, silent);
  await assert.rejects(() => notifier.notify(event('down', 'up')), /responded 500/);
  respondWith = 200;
});

/* ---------------- dispatch ---------------- */

test('dispatch reports nothing to do when there are no transitions', async () => {
  const summary = await dispatchTransitions(
    notifiersFromEnv({ STATUSDOG_WEBHOOK_URL: hook.url }),
    [],
  );
  assert.deepEqual(summary, { transitions: 0, attempted: 0, delivered: 0, failed: 0, outcomes: [] });
});

test('dispatch fans every transition out to every notifier', async () => {
  received.length = 0;
  respondWith = 200;

  const notifiers = notifiersFromEnv({
    STATUSDOG_WEBHOOK_URL: `${hook.url}/one,${hook.url}/two`,
  });
  const summary = await dispatchTransitions(notifiers, [event('down', 'up'), event('up', 'down')]);

  assert.equal(summary.transitions, 2);
  assert.equal(summary.attempted, 4, '2 transitions x 2 notifiers');
  assert.equal(summary.delivered, 4);
  assert.equal(summary.failed, 0);
  assert.equal(received.length, 4);
});

test('a failing webhook is reported, not thrown', async () => {
  const dead = notifiersFromEnv({ STATUSDOG_WEBHOOK_URL: 'http://127.0.0.1:1/hook' });
  const summary = await dispatchTransitions(dead, [event('down', 'up')]);

  assert.equal(summary.attempted, 1);
  assert.equal(summary.delivered, 0);
  assert.equal(summary.failed, 1);
  assert.ok(summary.outcomes[0]!.error, 'the reason comes back in the summary');
  assert.ok(!summary.outcomes[0]!.notifier.includes('/hook'), 'no path in the label');
});

test('one dead notifier does not stop a healthy one', async () => {
  received.length = 0;
  respondWith = 200;

  const notifiers = notifiersFromEnv({
    STATUSDOG_WEBHOOK_URL: `http://127.0.0.1:1/dead,${hook.url}/alive`,
  });
  const summary = await dispatchTransitions(notifiers, [event('down', 'up')]);

  assert.equal(summary.delivered, 1);
  assert.equal(summary.failed, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0]!.path, '/alive');
});
