import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { probeUrl } from '../src/monitor/probe.js';
import { startTestServer } from './helpers.js';

const server = await startTestServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  switch (path) {
    case '/ok':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    case '/boom':
      res.writeHead(500);
      res.end('kaboom');
      return;
    case '/redirect':
      res.writeHead(302, { location: '/ok' });
      res.end();
      return;
    case '/loop':
      res.writeHead(302, { location: '/loop' });
      res.end();
      return;
    case '/cookie':
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': 'session=super-secret; HttpOnly',
        authorization: 'Bearer leaked',
      });
      res.end('ok');
      return;
    case '/slow':
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 300);
      return;
    default:
      res.writeHead(404);
      res.end('not found');
  }
});

after(() => server.close());

test('a healthy endpoint passes', async () => {
  const result = await probeUrl(`${server.url}/ok`);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.reason, null);
  assert.ok(result.responseTimeMs >= 0);
});

test('a 5xx fails with reason "status"', async () => {
  const result = await probeUrl(`${server.url}/boom`);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.reason, 'status');
  assert.match(result.message ?? '', /Unexpected status 500/);
});

test('a 404 fails against the default expectations', async () => {
  const result = await probeUrl(`${server.url}/missing`);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.reason, 'status');
});

test('redirects are followed and recorded as a chain', async () => {
  const result = await probeUrl(`${server.url}/redirect`);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.redirects, 1);
  assert.equal(result.finalUrl, `${server.url}/ok`);
  assert.deepEqual(result.detail?.chain, [
    { url: `${server.url}/redirect`, status: 302, location: '/ok' },
  ]);
});

test('detail reports headers, and no TLS over plain http', async () => {
  const result = await probeUrl(`${server.url}/ok`);
  assert.equal(result.detail?.headers['content-type'], 'application/json');
  assert.equal(result.detail?.tls, null);
});

test('detail never leaks credential-bearing headers', async () => {
  const result = await probeUrl(`${server.url}/cookie`, { expectStatus: ['*'] });
  const names = Object.keys(result.detail?.headers ?? {});
  assert.ok(names.includes('content-type'), 'curated headers are still present');
  assert.ok(!names.includes('set-cookie'));
  assert.ok(!names.includes('authorization'));
});

test('a failed probe has no detail to report', async () => {
  const result = await probeUrl('http://127.0.0.1:1/', { timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.equal(result.detail, null);
});

test('redirects can be disabled', async () => {
  const result = await probeUrl(`${server.url}/redirect`, {
    followRedirects: false,
    expectStatus: ['2xx'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 302);
  assert.equal(result.redirects, 0);
});

test('redirect loops are bounded', async () => {
  const result = await probeUrl(`${server.url}/loop`, { maxRedirects: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.match(result.message ?? '', /Exceeded 2 redirects/);
});

test('body expectations are enforced', async () => {
  const pass = await probeUrl(`${server.url}/ok`, { expectBody: '"status":"ok"' });
  assert.equal(pass.ok, true);

  const fail = await probeUrl(`${server.url}/ok`, { expectBody: '"status":"degraded"' });
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'body');
});

test('slow responses fail when maxResponseTimeMs is set', async () => {
  const result = await probeUrl(`${server.url}/slow`, { maxResponseTimeMs: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'slow');
});

test('timeouts are reported, not thrown', async () => {
  const result = await probeUrl(`${server.url}/slow`, { timeoutMs: 60 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.equal(result.status, null);
});

test('a refused connection is reported', async () => {
  // Port 1 is reserved and never listening.
  const result = await probeUrl('http://127.0.0.1:1/', { timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.ok(['refused', 'network', 'timeout'].includes(result.reason ?? ''));
});

test('an unusable URL fails without throwing', async () => {
  const result = await probeUrl('ftp://example.com');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-url');
});
