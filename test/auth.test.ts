import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  adminConfigured,
  adminEmails,
  authorize,
  clearCookie,
  cookieHeader,
  createSession,
  isAllowed,
  parseCookies,
  readSession,
  safeNextPath,
  sameOriginWrite,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../src/auth/session.js';
import { authorizeUrl, exchangeCode, GoogleAuthError, newState } from '../src/auth/google.js';
import { isLocalOrigin, originOf } from '../src/util/origin.js';

const SECRET = 'a-test-secret-not-a-real-one';
const NOW = Date.parse('2026-08-20T12:00:00.000Z');

function env(over: Record<string, string | undefined> = {}) {
  return {
    STATUSDOG_SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    STATUSDOG_ADMIN_EMAILS: 'owner@example.com',
    ...over,
  };
}

/* ---------------- the allowlist is the gate ---------------- */

test('nothing is authorized when no allowlist is configured', () => {
  // Google sign-in authenticates anyone on earth. Without a list, "signed in"
  // would mean "may write", which is worse than having no admin surface at all.
  assert.equal(isAllowed('anyone@gmail.com', ''), false);
  assert.equal(isAllowed('anyone@gmail.com', undefined), false);
  assert.equal(isAllowed('anyone@gmail.com', '   '), false);
});

test('the allowlist is matched case- and space-insensitively', () => {
  const list = ' Owner@Example.com , second@example.com ';
  assert.equal(isAllowed('owner@example.com', list), true);
  assert.equal(isAllowed('OWNER@EXAMPLE.COM', list), true);
  assert.equal(isAllowed('  second@example.com ', list), true);
  assert.equal(isAllowed('other@example.com', list), false);
  assert.deepEqual(adminEmails(list), ['owner@example.com', 'second@example.com']);
});

test('an empty or missing address never matches', () => {
  assert.equal(isAllowed('', 'owner@example.com'), false);
  assert.equal(isAllowed(null, 'owner@example.com'), false);
  assert.equal(isAllowed(undefined, 'owner@example.com'), false);
});

test('a half-configured deployment has no admin surface', () => {
  assert.equal(adminConfigured(env()), true);
  for (const missing of [
    'STATUSDOG_SESSION_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'STATUSDOG_ADMIN_EMAILS',
  ]) {
    assert.equal(adminConfigured(env({ [missing]: undefined })), false, missing);
  }
});

/* ---------------- sessions ---------------- */

test('a session round-trips and carries the address', () => {
  const token = createSession('Owner@Example.com', SECRET, NOW);
  const session = readSession(token, SECRET, NOW);
  assert.equal(session?.sub, 'owner@example.com', 'stored lowercased');
  assert.equal(session?.exp, NOW + SESSION_TTL_MS);
});

test('a tampered payload is rejected', () => {
  const token = createSession('owner@example.com', SECRET, NOW);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({
    sub: 'attacker@example.com',
    iat: NOW,
    exp: NOW + SESSION_TTL_MS,
  })).toString('base64url');

  assert.equal(readSession(`${forged}.${signature}`, SECRET, NOW), null);
  assert.ok(payload);
});

test('a token signed with another secret is rejected', () => {
  const token = createSession('owner@example.com', 'a-different-secret-entirely', NOW);
  assert.equal(readSession(token, SECRET, NOW), null);
});

test('rotating the secret invalidates every existing session', () => {
  // This is the revocation story for a lost laptop, so it has to hold.
  const token = createSession('owner@example.com', SECRET, NOW);
  assert.ok(readSession(token, SECRET, NOW));
  assert.equal(readSession(token, `${SECRET}-rotated`, NOW), null);
});

test('an expired session is rejected on the second it expires', () => {
  const token = createSession('owner@example.com', SECRET, NOW);
  assert.ok(readSession(token, SECRET, NOW + SESSION_TTL_MS - 1));
  assert.equal(readSession(token, SECRET, NOW + SESSION_TTL_MS), null);
});

test('malformed input is rejected rather than throwing', () => {
  for (const bad of ['', 'nonsense', 'a.b.c', '.', 'not-base64.sig', null, undefined]) {
    assert.doesNotThrow(() => readSession(bad as string, SECRET, NOW));
    assert.equal(readSession(bad as string, SECRET, NOW), null, String(bad));
  }
  assert.equal(readSession(createSession('owner@example.com', SECRET, NOW), undefined, NOW), null);
});

test('a session with no expiry is not treated as eternal', () => {
  // Hand-built payloads must not slip through with a missing or absurd exp.
  const encoded = Buffer.from(JSON.stringify({ sub: 'owner@example.com', iat: NOW })).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  assert.equal(readSession(`${encoded}.${signature}`, SECRET, NOW), null);
});

/* ---------------- request authorization ---------------- */

function cookie(token: string): string {
  return `other=1; ${SESSION_COOKIE}=${encodeURIComponent(token)}; another=2`;
}

test('a valid session for an allowed address is authorized', () => {
  const token = createSession('owner@example.com', SECRET, NOW);
  const auth = authorize(cookie(token), env(), NOW);
  assert.deepEqual(auth, { ok: true, email: 'owner@example.com', reason: null });
});

test('removing an address from the environment revokes it immediately', () => {
  // The allowlist is re-read per request rather than trusted from the cookie, so
  // access does not linger until the session happens to expire.
  const token = createSession('owner@example.com', SECRET, NOW);
  const auth = authorize(cookie(token), env({ STATUSDOG_ADMIN_EMAILS: 'someone-else@example.com' }), NOW);
  assert.equal(auth.ok, false);
  assert.equal(auth.reason, 'not-allowed');
});

test('no cookie, no configuration, no authorization', () => {
  assert.equal(authorize(undefined, env(), NOW).reason, 'no-session');
  assert.equal(authorize('', env(), NOW).reason, 'no-session');
  assert.equal(authorize(cookie(createSession('owner@example.com', SECRET, NOW)), {}, NOW).reason, 'not-configured');
});

/* ---------------- cookies ---------------- */

test('cookies are locked down by default', () => {
  const header = cookieHeader('x', 'value', { maxAgeSeconds: 60 });
  assert.ok(header.includes('HttpOnly'), 'not readable from script');
  assert.ok(header.includes('Secure'), 'https only');
  assert.ok(header.includes('SameSite=Lax'));
  assert.ok(header.includes('Path=/'));
  assert.ok(header.includes('Max-Age=60'));
});

test('Secure is dropped only when explicitly asked, for localhost', () => {
  assert.ok(!cookieHeader('x', 'v', { secure: false }).includes('Secure'));
  assert.ok(isLocalOrigin('http://127.0.0.1:3100'));
  assert.ok(isLocalOrigin('http://localhost:3000'));
  assert.ok(!isLocalOrigin('https://status-dog.vercel.app'));
});

test('clearing a cookie expires it immediately', () => {
  assert.ok(clearCookie('x').includes('Max-Age=0'));
});

test('cookie parsing survives the mess a real browser sends', () => {
  const parsed = parseCookies('a=1; b=hello%20world; broken; =nope; c=');
  assert.equal(parsed.a, '1');
  assert.equal(parsed.b, 'hello world');
  assert.equal(parsed.c, '');
  assert.equal(parsed.broken, undefined);
  assert.deepEqual(parseCookies(undefined), {});
});

test('an undecodable cookie is treated as absent, not as a crash', () => {
  assert.doesNotThrow(() => parseCookies('a=%E0%A4%A'));
  assert.equal(parseCookies('a=%E0%A4%A').a, undefined);
});

/* ---------------- CSRF ---------------- */

const SITE = 'https://status-dog.vercel.app';

test('a same-origin write with the custom header is allowed', () => {
  assert.equal(sameOriginWrite({ origin: SITE, 'x-statusdog-admin': '1' }, SITE), true);
});

test('a cross-site post is refused even with a valid session cookie', () => {
  assert.equal(sameOriginWrite({ origin: 'https://evil.example', 'x-statusdog-admin': '1' }, SITE), false);
});

test('a request with no Origin header is refused', () => {
  // A plain HTML form post from another page is exactly this shape.
  assert.equal(sameOriginWrite({ 'x-statusdog-admin': '1' }, SITE), false);
  assert.equal(sameOriginWrite({ origin: '' }, SITE), false);
});

test('the custom header is required as a second, independent barrier', () => {
  assert.equal(sameOriginWrite({ origin: SITE }, SITE), false);
  assert.equal(sameOriginWrite({ origin: SITE, 'x-statusdog-admin': '' }, SITE), false);
});

/* ---------------- the return path ---------------- */

test('a path on this site is kept', () => {
  assert.equal(safeNextPath('/status/copykiller'), '/status/copykiller');
  assert.equal(safeNextPath('/status/copykiller?x=1'), '/status/copykiller?x=1');
});

test('anything that could leave the site falls back', () => {
  // An open redirect here would let a link sign the owner in and bounce them to a
  // lookalike site, which is the classic way this parameter goes wrong.
  for (const bad of [
    '//evil.example',
    'https://evil.example',
    'http://evil.example',
    'evil.example',
    '',
    null,
    undefined,
    `/x${String.fromCharCode(92)}y`,
  ]) {
    assert.equal(safeNextPath(bad), '/dashboard', String(bad));
  }
});

test('control characters and absurd lengths fall back', () => {
  assert.equal(safeNextPath(`/a${String.fromCharCode(10)}b`), '/dashboard');
  assert.equal(safeNextPath(`/${'x'.repeat(600)}`), '/dashboard');
});

/* ---------------- origin ---------------- */

test('the configured site URL wins over any header', () => {
  const origin = originOf(
    { headers: { host: 'attacker.example' } },
    { STATUSDOG_SITE_URL: 'https://status-dog.vercel.app/' },
  );
  assert.equal(origin, 'https://status-dog.vercel.app', 'trailing slash trimmed');
});

test('a host that is not a hostname falls back rather than being echoed', () => {
  for (const host of ['evil.example/path', 'a b', 'http://x', '']) {
    assert.equal(originOf({ headers: { host } }, {}), 'https://status-dog.vercel.app', host);
  }
});

test('localhost is http, everything else is https', () => {
  assert.equal(originOf({ headers: { host: '127.0.0.1:3100' } }, {}), 'http://127.0.0.1:3100');
  assert.equal(originOf({ headers: { host: 'example.com' } }, {}), 'https://example.com');
  assert.equal(
    originOf({ headers: { host: 'example.com', 'x-forwarded-proto': 'http' } }, {}),
    'http://example.com',
  );
});

test('a comma-joined proxy header uses the first value', () => {
  assert.equal(
    originOf({ headers: { 'x-forwarded-host': 'a.example, b.example' } }, {}),
    'https://a.example',
  );
});

/* ---------------- the Google flow ---------------- */

test('the authorize URL asks for identity and nothing more', () => {
  const url = new URL(authorizeUrl({
    clientId: 'client-id',
    redirectUri: `${SITE}/api/auth/callback`,
    state: 'the-state',
  }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'the-state');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
});

test('state values are unguessable and never repeat', () => {
  const values = new Set(Array.from({ length: 50 }, () => newState()));
  assert.equal(values.size, 50);
  assert.ok(newState().length >= 32);
});

function fakeGoogle(overrides: { token?: unknown; info?: unknown; tokenOk?: boolean; infoOk?: boolean } = {}) {
  return (async (input: string | URL) => {
    const url = String(input);
    const ok = url.includes('tokeninfo') ? overrides.infoOk !== false : overrides.tokenOk !== false;
    const body = url.includes('tokeninfo')
      ? overrides.info ?? { aud: 'client-id', email: 'Owner@Example.com', email_verified: 'true' }
      : overrides.token ?? { id_token: 'an-id-token' };
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const exchange = (fetchImpl: typeof fetch) => exchangeCode({
  code: 'the-code',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: `${SITE}/api/auth/callback`,
  fetchImpl,
});

test('a verified address comes back lowercased', async () => {
  const identity = await exchange(fakeGoogle());
  assert.deepEqual(identity, { email: 'owner@example.com', emailVerified: true });
});

test('an unverified address is refused', async () => {
  await assert.rejects(
    exchange(fakeGoogle({ info: { aud: 'client-id', email: 'owner@example.com', email_verified: 'false' } })),
    GoogleAuthError,
  );
});

test('a token minted for another application is refused', async () => {
  // Without this check an ID token from any other Google app would be accepted.
  await assert.rejects(
    exchange(fakeGoogle({ info: { aud: 'someone-elses-client', email: 'owner@example.com', email_verified: 'true' } })),
    /different client/,
  );
});

test('a token carrying no address is refused', async () => {
  await assert.rejects(
    exchange(fakeGoogle({ info: { aud: 'client-id', email_verified: 'true' } })),
    /no email/,
  );
});

test('a failed exchange or verification is an error, not a silent pass', async () => {
  await assert.rejects(exchange(fakeGoogle({ tokenOk: false })), /Token exchange failed/);
  await assert.rejects(exchange(fakeGoogle({ infoOk: false })), /Token verification failed/);
  await assert.rejects(exchange(fakeGoogle({ token: {} })), /No id_token/);
});
