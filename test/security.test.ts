import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessHeaders,
  externalSources,
  findDefacement,
  nextSecurity,
  SOURCE_FORGET_MS,
  type HeaderCheck,
  type SecurityObservation,
} from '../src/monitor/security.js';
import {
  CT_INTERVAL_MS,
  CT_RETRY_MS,
  ctDue,
  ctQuery,
  failedCt,
  nextCt,
  parseCrtSh,
  type CtEntry,
} from '../src/monitor/ct.js';
import { observeSecurity } from '../src/monitor/security-run.js';
import { resolveConfig } from '../src/config/index.js';
import type { ProbeResult } from '../src/config/types.js';

const HARDENED = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
  server: 'nginx',
};

const level = (checks: HeaderCheck[], id: string) => checks.find((check) => check.id === id);

/* ---------------- headers ---------------- */

test('a hardened response passes every check', () => {
  const checks = assessHeaders(HARDENED, 'https://example.com/');
  assert.deepEqual(checks.map((check) => check.level), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
});

test('copykiller today: no HSTS, a CSP that restricts nothing, no framing or sniffing guard', () => {
  const checks = assessHeaders(
    { server: 'istio-envoy', 'content-security-policy': 'upgrade-insecure-requests' },
    'https://www.copykiller.com/',
  );
  assert.equal(level(checks, 'hsts')!.level, 'warn');
  assert.deepEqual(level(checks, 'csp'), {
    id: 'csp', level: 'warn', value: 'upgrade-insecure-requests', note: 'no-script-policy',
  });
  assert.equal(level(checks, 'framing')!.level, 'warn');
  assert.equal(level(checks, 'nosniff')!.level, 'warn');
  // A server name without a version gives nothing away.
  assert.equal(level(checks, 'version')!.level, 'pass');
  // Nice-to-haves are never warnings.
  assert.equal(level(checks, 'referrer')!.level, 'info');
});

test('a short HSTS lifetime is a warning, and plain http is called out as such', () => {
  const short = assessHeaders({ 'strict-transport-security': 'max-age=3600' }, 'https://e.com/');
  assert.equal(level(short, 'hsts')!.note, 'short-max-age');
  assert.equal(level(assessHeaders(HARDENED, 'http://e.com/'), 'hsts')!.note, 'not-https');
});

test('either X-Frame-Options or frame-ancestors blocks framing', () => {
  assert.equal(level(assessHeaders({ 'x-frame-options': 'SAMEORIGIN' }, 'https://e.com/'), 'framing')!.level, 'pass');
  assert.equal(level(assessHeaders({ 'x-frame-options': 'ALLOW-FROM x' }, 'https://e.com/'), 'framing')!.level, 'warn');
  assert.equal(
    level(assessHeaders({ 'content-security-policy': "frame-ancestors 'self'" }, 'https://e.com/'), 'framing')!.level,
    'pass',
  );
});

test('a version number is flagged, and an unsupported PHP line by name', () => {
  assert.equal(level(assessHeaders({ server: 'nginx/1.18.0' }, 'https://e.com/'), 'version')!.note, 'disclosed');
  assert.equal(level(assessHeaders({ 'x-powered-by': 'PHP/7.4.33' }, 'https://e.com/'), 'version')!.note, 'php-eol');
  assert.equal(level(assessHeaders({ 'x-powered-by': 'PHP/8.1.2' }, 'https://e.com/'), 'version')!.note, 'php-eol');
  assert.equal(level(assessHeaders({ 'x-powered-by': 'PHP/8.3.1' }, 'https://e.com/'), 'version')!.note, 'disclosed');
});

/* ---------------- sources and defacement ---------------- */

test('only other hosts count, by origin, for scripts and frames', () => {
  const html = `
    <script src="/app.js"></script>
    <script src="https://example.com/x.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
    <script src="https://www.googletagmanager.com/other.js"></script>
    <iframe src="https://www.youtube.com/embed/abc"></iframe>
    <script src="data:text/javascript,1"></script>
    <script>inline()</script>`;
  assert.deepEqual(externalSources(html, 'https://example.com/'), [
    { origin: 'https://www.googletagmanager.com', kind: 'script' },
    { origin: 'https://www.youtube.com', kind: 'iframe' },
  ]);
});

test('defacement text is found; ordinary copy is not', () => {
  assert.match(findDefacement('Welcome. Hacked by Some Crew. greetz') ?? '', /Hacked by/);
  assert.equal(findDefacement('© 2026 Muhayu. Owned by its shareholders. Hacking prevention guide'), null);
});

/* ---------------- state across runs ---------------- */

let clock = Date.parse('2026-10-01T00:00:00Z');
function obs(over: Partial<SecurityObservation> = {}): SecurityObservation {
  clock += 5 * 60_000;
  return {
    at: new Date(clock).toISOString(),
    finalUrl: 'https://example.com/',
    headers: HARDENED,
    body: '<script src="https://cdn.example.net/a.js"></script>',
    visible: 'Welcome',
    tls: { issuer: 'DigiCert Inc', fingerprint: 'AA', validTo: 'Nov 28 2026' },
    ...over,
  };
}

test('the first observation is the baseline: nothing in it is news', () => {
  const { state, findings } = nextSecurity(null, obs({ headers: {} }));
  assert.deepEqual(findings, []);
  assert.equal(state.baselineAt, state.observedAt);
  assert.equal(state.sources.length, 1);
});

test('a protection that was in place and disappears is reported once', () => {
  let { state } = nextSecurity(null, obs());
  const lost = nextSecurity(state, obs({ headers: { ...HARDENED, 'x-content-type-options': '' } }));
  assert.deepEqual(lost.findings.map((f) => [f.kind, f.subject]), [['header-lost', 'nosniff']]);
  state = lost.state;
  // Still missing next time: already known, not news again.
  assert.deepEqual(nextSecurity(state, obs({ headers: { ...HARDENED, 'x-content-type-options': '' } })).findings, []);
});

test('a header that was always missing never alerts', () => {
  const { state } = nextSecurity(null, obs({ headers: {} }));
  assert.deepEqual(nextSecurity(state, obs({ headers: {} })).findings, []);
});

test('a script from a never-seen host alerts; a known one coming and going does not', () => {
  const { state } = nextSecurity(null, obs());
  const skimmer = nextSecurity(state, obs({
    body: '<script src="https://cdn.example.net/a.js"></script><script src="https://evil.test/s.js"></script>',
  }));
  assert.deepEqual(skimmer.findings.map((f) => [f.kind, f.subject]), [['new-source', 'https://evil.test']]);

  const gone = nextSecurity(skimmer.state, obs({ body: '' }));
  const back = nextSecurity(gone.state, obs());
  assert.deepEqual(back.findings, []);
});

test('a host unseen for a month is forgotten', () => {
  const { state } = nextSecurity(null, obs());
  clock += SOURCE_FORGET_MS;
  const later = nextSecurity(state, obs({ body: '' }));
  assert.equal(later.state.sources.length, 0);
});

test('defacement alerts when it appears, not again while it stays, and clears when gone', () => {
  const { state } = nextSecurity(null, obs());
  const defaced = nextSecurity(state, obs({ visible: 'hacked by someone' }));
  assert.equal(defaced.findings[0]!.kind, 'defacement');
  assert.equal(defaced.findings[0]!.severity, 'critical');
  const still = nextSecurity(defaced.state, obs({ visible: 'hacked by someone' }));
  assert.deepEqual(still.findings, []);
  assert.equal(nextSecurity(still.state, obs()).state.defacement, null);
});

test('a renewal from the same issuer is routine; a new issuer is reported', () => {
  const { state } = nextSecurity(null, obs());
  const renewed = nextSecurity(state, obs({ tls: { issuer: 'DigiCert Inc', fingerprint: 'BB', validTo: 'x' } }));
  assert.deepEqual(renewed.findings, []);
  assert.equal(renewed.state.cert!.previousIssuer, 'DigiCert Inc');
  const swapped = nextSecurity(renewed.state, obs({ tls: { issuer: 'Unknown CA', fingerprint: 'CC', validTo: 'x' } }));
  assert.deepEqual(swapped.findings.map((f) => [f.kind, f.subject, f.detail]), [['issuer-changed', 'Unknown CA', 'DigiCert Inc']]);
});

/* ---------------- certificate transparency ---------------- */

test('the lookup covers the registrable domain, except on shared platforms', () => {
  assert.deepEqual(ctQuery('www.copykiller.com'), { domain: 'copykiller.com', pattern: '%.copykiller.com' });
  assert.deepEqual(ctQuery('shop.example.co.kr'), { domain: 'example.co.kr', pattern: '%.example.co.kr' });
  // Every other Vercel customer is under vercel.app; their certificates are not ours.
  assert.deepEqual(ctQuery('status-dog.vercel.app'), { domain: 'status-dog.vercel.app', pattern: 'status-dog.vercel.app' });
  assert.deepEqual(ctQuery('127.0.0.1'), { domain: '127.0.0.1', pattern: '127.0.0.1' });
});

test('issuers are compared by organisation, not by rotating intermediate', () => {
  const rows = parseCrtSh([
    { id: 1, issuer_name: 'C=US, O=Amazon, CN=Amazon RSA 2048 M01', name_value: 'copykiller.com\n*.copykiller.com', not_before: '2026-01-01' },
    { id: 2, issuer_name: 'C=US, O=Amazon, CN=Amazon RSA 2048 M04', name_value: 'COPYKILLER.COM' },
    { id: 'x' },
    null,
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.issuerOrg, r.names]), [
    [1, 'Amazon', ['copykiller.com', '*.copykiller.com']],
    [2, 'Amazon', ['copykiller.com']],
  ]);
  assert.deepEqual(parseCrtSh({ not: 'an array' }), []);
});

const cert = (id: number, issuerOrg: string, names: string[]): CtEntry => ({ id, issuerOrg, names, notBefore: null });

test('the first lookup is history; later ones report new authorities and host names', () => {
  const base = nextCt(null, 'copykiller.com', [cert(1, 'DigiCert Inc', ['*.copykiller.com'])], '2026-10-01T00:00:00Z');
  assert.deepEqual(base.findings, []);

  const renewal = nextCt(base.state, 'copykiller.com', [
    cert(1, 'DigiCert Inc', ['*.copykiller.com']),
    cert(2, 'DigiCert Inc', ['*.copykiller.com']),
  ], '2026-10-02T00:00:00Z');
  assert.deepEqual(renewal.findings, [], 'a routine renewal is not news');

  const odd = nextCt(renewal.state, 'copykiller.com', [cert(3, 'Shady CA', ['login.copykiller.com'])], '2026-10-03T00:00:00Z');
  assert.deepEqual(odd.findings.map((f) => [f.kind, f.subject]), [
    ['ct-new-issuer', 'Shady CA'],
    ['ct-new-name', 'login.copykiller.com'],
  ]);
  assert.equal(odd.state.recent.at(-1)!.newIssuer, true);
});

test('lookups are daily, a failure is retried within the hour, and keeps what was known', () => {
  const now = Date.parse('2026-10-02T00:00:00Z');
  assert.equal(ctDue(null, 'a.com', now), true);
  const { state } = nextCt(null, 'a.com', [cert(1, 'X', ['a.com'])], new Date(now).toISOString());
  assert.equal(ctDue(state, 'a.com', now + CT_INTERVAL_MS - 1), false);
  assert.equal(ctDue(state, 'a.com', now + CT_INTERVAL_MS), true);
  assert.equal(ctDue(state, 'b.com', now), true, 'a different domain starts over');

  const failed = failedCt(state, 'a.com', new Date(now + CT_INTERVAL_MS).toISOString(), 'timeout');
  assert.deepEqual(failed.issuers, ['X']);
  assert.equal(failed.checkedAt, state.checkedAt);
  assert.equal(ctDue(failed, 'a.com', now + CT_INTERVAL_MS + CT_RETRY_MS - 1), false);
  assert.equal(ctDue(failed, 'a.com', now + CT_INTERVAL_MS + CT_RETRY_MS), true);
});

/* ---------------- one run ---------------- */

const target = resolveConfig({ targets: [{ id: 'site', name: 'Site', url: 'https://www.example.com/' }] }).targets[0]!;

function home(ok = true): { result: ProbeResult; body: string | null } {
  return {
    result: {
      url: target.url,
      finalUrl: target.url,
      ok,
      status: ok ? 200 : 503,
      responseTimeMs: 10,
      redirects: 0,
      checkedAt: '2026-10-01T00:00:00Z',
      reason: ok ? null : 'status',
      message: null,
      detail: {
        headers: HARDENED,
        tls: null,
        chain: [],
        peer: null,
        bodySize: 10,
        bodyExcerpt: null,
      },
    },
    body: ok ? '<h1>hi</h1>' : null,
  };
}

test('a run records the page and the certificate logs together', async () => {
  const asked: string[] = [];
  const run = await observeSecurity({
    target,
    home: home(),
    conclusive: true,
    previous: null,
    at: '2026-10-01T00:00:00Z',
    ctLookup: async (pattern) => {
      asked.push(pattern);
      return [cert(1, 'DigiCert Inc', ['www.example.com'])];
    },
  });
  assert.deepEqual(asked, ['%.example.com']);
  assert.equal(run.security!.headers.length, 7);
  assert.equal(run.security!.ct!.issuers[0], 'DigiCert Inc');
  assert.deepEqual(run.alerts, []);
});

test('a failed home check leaves the page observations alone, and a failed lookup is recorded', async () => {
  const first = await observeSecurity({
    target, home: home(), conclusive: true, previous: null, at: '2026-10-01T00:00:00Z',
    ctLookup: async () => [],
  });
  const run = await observeSecurity({
    target,
    home: home(false),
    conclusive: true,
    previous: first.security!,
    at: '2026-10-02T01:00:00Z',
    ctLookup: async () => { throw new Error('crt.sh responded 502'); },
  });
  assert.equal(run.security!.observedAt, first.security!.observedAt);
  assert.equal(run.security!.ct!.error, 'crt.sh responded 502');
});

test('nothing due and nothing observable leaves the stored state untouched', async () => {
  const first = await observeSecurity({
    target, home: home(), conclusive: true, previous: null, at: '2026-10-01T00:00:00Z',
    ctLookup: async () => [],
  });
  const run = await observeSecurity({
    target, home: home(), conclusive: false, previous: first.security!, at: '2026-10-01T00:05:00Z',
    ctLookup: async () => { throw new Error('should not be asked'); },
  });
  assert.equal(run.security, undefined);
});
