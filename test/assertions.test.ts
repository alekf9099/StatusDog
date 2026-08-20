import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  findForbidden,
  findHeaderMismatch,
  normalizeUrlForComparison,
  sameUrl,
  toPatternList,
} from '../src/monitor/assertions.js';
import { probeUrl } from '../src/monitor/probe.js';
import { resolveConfig } from '../src/config/index.js';
import { startTestServer } from './helpers.js';

/* ---------------- forbidden text ---------------- */

test('forbidden text is matched case-insensitively', () => {
  // A stack trace says "Error", a proxy says "error" — both are the same bad news.
  assert.equal(findForbidden('Internal Error occurred', ['error'], false), 'error');
  assert.equal(findForbidden('internal error occurred', ['Error'], false), 'Error');
  assert.equal(findForbidden('all good', ['error'], false), null);
});

test('the first matching pattern is the one reported', () => {
  const body = 'Gateway Timeout while rendering';
  assert.equal(findForbidden(body, ['502 Bad Gateway', 'Gateway Timeout'], false), 'Gateway Timeout');
});

test('an empty pattern never matches, so a blank config entry is inert', () => {
  assert.equal(findForbidden('anything', [''], false), null);
  assert.equal(findForbidden('anything', [], false), null);
});

test('regex mode is supported, and a broken pattern does not throw', () => {
  assert.equal(findForbidden('HTTP 502 upstream', ['50[24]'], true), '50[24]');
  assert.equal(findForbidden('fine', ['50[24]'], true), null);
  assert.doesNotThrow(() => findForbidden('anything', ['[unclosed'], true));
  assert.equal(findForbidden('anything', ['[unclosed'], true), null);
});

test('config accepts one pattern or several', () => {
  assert.deepEqual(toPatternList('502'), ['502']);
  assert.deepEqual(toPatternList(['502', '504']), ['502', '504']);
  assert.deepEqual(toPatternList(''), []);
  assert.deepEqual(toPatternList(undefined), []);
  assert.deepEqual(toPatternList(['ok', 42, null]), ['ok'], 'non-strings are dropped');
});

/* ---------------- header expectations ---------------- */

test('a missing header is reported as missing, not as a wrong value', () => {
  const mismatch = findHeaderMismatch({}, { 'strict-transport-security': true });
  assert.deepEqual(mismatch, {
    name: 'strict-transport-security',
    expected: true,
    actual: null,
  });
});

test('presence is enough when the expectation is true', () => {
  assert.equal(
    findHeaderMismatch({ 'strict-transport-security': 'max-age=31536000' }, { 'strict-transport-security': true }),
    null,
  );
});

test('a string expectation must be contained, case-insensitively', () => {
  const headers = { 'content-type': 'Application/JSON; charset=utf-8' };
  assert.equal(findHeaderMismatch(headers, { 'content-type': 'application/json' }), null);

  const mismatch = findHeaderMismatch(headers, { 'content-type': 'text/html' });
  assert.equal(mismatch?.name, 'content-type');
  assert.equal(mismatch?.actual, 'Application/JSON; charset=utf-8');
});

test('a repeated header is joined rather than losing values', () => {
  const headers = { 'cache-control': ['no-store', 'must-revalidate'] };
  assert.equal(findHeaderMismatch(headers, { 'cache-control': 'must-revalidate' }), null);
});

test('every expectation is checked, and the first failure wins', () => {
  const headers = { 'x-frame-options': 'DENY' };
  const mismatch = findHeaderMismatch(headers, {
    'x-frame-options': true,
    'content-security-policy': true,
  });
  assert.equal(mismatch?.name, 'content-security-policy');
});

test('no expectations means nothing to fail', () => {
  assert.equal(findHeaderMismatch({ server: 'nginx' }, {}), null);
});

/* ---------------- final URL comparison ---------------- */

test('a trailing slash is not a redirect change', () => {
  assert.ok(sameUrl('https://example.com/', 'https://example.com'));
  assert.ok(sameUrl('https://example.com/health/', 'https://example.com/health'));
});

test('a default port is not a redirect change', () => {
  assert.ok(sameUrl('https://example.com:443/', 'https://example.com/'));
  assert.ok(sameUrl('http://example.com:80/x', 'http://example.com/x'));
  assert.ok(!sameUrl('https://example.com:8443/', 'https://example.com/'));
});

test('a fragment is ignored but a query is not', () => {
  assert.ok(sameUrl('https://example.com/a#top', 'https://example.com/a'));
  assert.ok(!sameUrl('https://example.com/a?b=1', 'https://example.com/a'));
});

test('scheme and host changes are real changes', () => {
  assert.ok(!sameUrl('http://example.com/', 'https://example.com/'));
  assert.ok(!sameUrl('https://www.example.com/', 'https://example.com/'));
});

test('an unparseable URL degrades to a trimmed string compare', () => {
  assert.equal(normalizeUrlForComparison('  NOT a url '), 'not a url');
  assert.ok(sameUrl('not a url', 'NOT A URL'));
});

/* ---------------- end to end through the probe ---------------- */

const server = await startTestServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  switch (path) {
    case '/ok':
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Welcome</h1>');
      return;
    case '/half-broken':
      // The case forbidden text exists for: a 200 carrying the bad news.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>502 Bad Gateway</h1><p>upstream did not respond</p>');
      return;
    case '/secure':
      res.writeHead(200, {
        'content-type': 'text/html',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-frame-options': 'DENY',
      });
      res.end('ok');
      return;
    case '/insecure':
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('ok');
      return;
    case '/hop1':
      res.writeHead(302, { location: '/hop2' });
      res.end();
      return;
    case '/hop2':
      res.writeHead(302, { location: '/ok' });
      res.end();
      return;
    default:
      res.writeHead(404);
      res.end('not found');
  }
});

after(() => server.close());

test('a 200 carrying "502 Bad Gateway" fails on the body, not the status', async () => {
  const clean = await probeUrl(`${server.url}/half-broken`);
  assert.equal(clean.ok, true, 'without the assertion it looks perfectly healthy');

  const guarded = await probeUrl(`${server.url}/half-broken`, {
    forbidBody: ['502 Bad Gateway', '504 Gateway Time-out'],
  });
  assert.equal(guarded.ok, false);
  assert.equal(guarded.status, 200, 'the status really was fine');
  assert.equal(guarded.reason, 'body');
  assert.match(guarded.message ?? '', /contained "502 Bad Gateway"/);
});

test('forbidden text does not fire on a healthy page', async () => {
  const result = await probeUrl(`${server.url}/ok`, { forbidBody: ['502', 'Exception'] });
  assert.equal(result.ok, true);
});

test('a missing security header fails the check', async () => {
  const present = await probeUrl(`${server.url}/secure`, {
    expectHeaders: { 'strict-transport-security': true, 'x-frame-options': 'DENY' },
  });
  assert.equal(present.ok, true);

  const absent = await probeUrl(`${server.url}/insecure`, {
    expectHeaders: { 'strict-transport-security': true },
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, 'header');
  assert.match(absent.message ?? '', /missing the strict-transport-security header/);
});

test('a header with the wrong value is reported with both sides', async () => {
  const result = await probeUrl(`${server.url}/secure`, {
    expectHeaders: { 'x-frame-options': 'SAMEORIGIN' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'header');
  assert.match(result.message ?? '', /was "DENY"/);
  assert.match(result.message ?? '', /expected it to contain "SAMEORIGIN"/);
});

test('an unexpected extra redirect hop fails', async () => {
  const asExpected = await probeUrl(`${server.url}/hop1`, { expectRedirects: 2 });
  assert.equal(asExpected.ok, true);
  assert.equal(asExpected.redirects, 2);

  const changed = await probeUrl(`${server.url}/hop1`, { expectRedirects: 1 });
  assert.equal(changed.ok, false);
  assert.equal(changed.reason, 'redirect');
  assert.match(changed.message ?? '', /Followed 2 redirect\(s\), expected 1/);
});

test('expecting no redirects catches an interstitial appearing', async () => {
  const direct = await probeUrl(`${server.url}/ok`, { expectRedirects: 0 });
  assert.equal(direct.ok, true);

  const redirected = await probeUrl(`${server.url}/hop1`, { expectRedirects: 0 });
  assert.equal(redirected.ok, false);
  assert.equal(redirected.reason, 'redirect');
});

test('the chain must end where it is supposed to', async () => {
  const right = await probeUrl(`${server.url}/hop1`, { expectFinalUrl: `${server.url}/ok` });
  assert.equal(right.ok, true);

  const wrong = await probeUrl(`${server.url}/hop1`, { expectFinalUrl: `${server.url}/somewhere-else` });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'redirect');
  assert.match(wrong.message ?? '', /Ended at/);
});

test('a trailing slash in the expectation is not a failure', async () => {
  const result = await probeUrl(`${server.url}/hop1`, { expectFinalUrl: `${server.url}/ok/` });
  assert.equal(result.ok, true);
});

test('status is judged before the new assertions, so the message stays useful', async () => {
  // A 404 with a missing header should say "404", not "missing header".
  const result = await probeUrl(`${server.url}/missing`, {
    expectHeaders: { 'strict-transport-security': true },
    forbidBody: ['not found'],
  });
  assert.equal(result.reason, 'status');
});

/* ---------------- config ---------------- */

test('the new fields resolve with sensible shapes', () => {
  const target = resolveConfig({
    targets: [{
      id: 'a',
      url: 'https://example.com',
      forbidBody: '502',
      expectHeaders: { 'Strict-Transport-Security': true },
      expectRedirects: 0,
      expectFinalUrl: 'https://example.com/',
    }],
  }).targets[0]!;

  assert.deepEqual(target.forbidBody, ['502'], 'a single pattern becomes a list');
  assert.deepEqual(target.expectHeaders, { 'strict-transport-security': true }, 'names are lowercased once');
  assert.equal(target.expectRedirects, 0);
  assert.equal(target.expectFinalUrl, 'https://example.com/');
});

test('absent assertions resolve to "no expectation", not to a falsy trap', () => {
  const target = resolveConfig({ targets: [{ id: 'a', url: 'https://example.com' }] }).targets[0]!;
  assert.deepEqual(target.forbidBody, []);
  assert.deepEqual(target.expectHeaders, {});
  assert.equal(target.expectRedirects, null, 'null, not 0 — zero hops is a real expectation');
  assert.equal(target.expectFinalUrl, null);
});

test('nonsense in the new fields is rejected at config load', () => {
  assert.throws(
    () => resolveConfig({
      targets: [{ id: 'a', url: 'https://example.com', expectHeaders: { x: 42 as unknown as string } }],
    }),
    /must be true \(present\) or a string/,
  );
  assert.throws(
    () => resolveConfig({ targets: [{ id: 'a', url: 'https://example.com', expectRedirects: -1 }] }),
    /non-negative integer/,
  );
  assert.throws(
    () => resolveConfig({ targets: [{ id: 'a', url: 'https://example.com', expectRedirects: 1.5 }] }),
    /non-negative integer/,
  );
});

test('defaults can carry header expectations for every target', () => {
  const config = resolveConfig({
    defaults: { expectHeaders: { 'strict-transport-security': true } },
    targets: [
      { id: 'a', url: 'https://example.com' },
      { id: 'b', url: 'https://example.com', expectHeaders: { 'x-frame-options': 'DENY' } },
    ],
  });
  assert.deepEqual(config.targets[0]!.expectHeaders, { 'strict-transport-security': true });
  assert.deepEqual(
    config.targets[1]!.expectHeaders,
    { 'strict-transport-security': true, 'x-frame-options': 'DENY' },
    'a target adds to the defaults rather than replacing them',
  );
});
