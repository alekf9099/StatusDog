/**
 * `GET /api/auth/callback` — finish the Google sign-in flow.
 *
 * Order matters here, and it is deliberately strictest-first:
 *
 *   1. is the admin surface configured at all
 *   2. does the returned `state` match the cookie this browser was given
 *   3. does Google confirm the code, and is the address verified
 *   4. is that address on the owner's allowlist
 *
 * Only after all four does a session exist. Step 4 is the one that matters most:
 * step 3 proves who somebody is, and everyone on earth can pass it.
 *
 * Failures redirect back to a page with a reason code rather than rendering an error
 * here, and the reason is coarse on purpose — the difference between "wrong code"
 * and "not on the list" is only useful to somebody probing.
 */
import { exchangeCode } from '../../dist/auth/google.js';
import {
  adminConfigured,
  clearCookie,
  cookieHeader,
  createSession,
  isAllowed,
  NEXT_COOKIE,
  parseCookies,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STATE_COOKIE,
} from '../../dist/auth/session.js';
import { isLocalOrigin, originOf } from '../../dist/util/origin.js';

function bounce(res, origin, next, reason, cookies) {
  res.setHeader('set-cookie', cookies);
  const separator = next.includes('?') ? '&' : '?';
  res
    .status(302)
    .setHeader('location', `${origin}${next}${separator}signin=${encodeURIComponent(reason)}`);
  res.end();
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (!adminConfigured(process.env)) {
    res.status(503).json({ error: 'The admin surface is not configured, so sign-in is closed.' });
    return;
  }

  const origin = originOf(req, process.env);
  const secure = !isLocalOrigin(origin);
  const cookies = parseCookies(req.headers?.cookie);
  // Both flow cookies have done their job either way; neither survives this request.
  const dropState = [clearCookie(STATE_COOKIE, { secure }), clearCookie(NEXT_COOKIE, { secure })];
  const next = safeNextPath(cookies[NEXT_COOKIE]);

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const code = query.get('code');
  const state = query.get('state');
  const expected = cookies[STATE_COOKIE];

  // The user may simply have declined at Google's screen.
  if (query.get('error')) return bounce(res, origin, next, 'cancelled', dropState);
  if (!code || !state || !expected || state !== expected) {
    return bounce(res, origin, next, 'expired', dropState);
  }

  let identity;
  try {
    identity = await exchangeCode({
      code,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${origin}/api/auth/callback`,
    });
  } catch {
    return bounce(res, origin, next, 'failed', dropState);
  }

  // Authenticated, but that is not the same as authorized.
  if (!isAllowed(identity.email, process.env.STATUSDOG_ADMIN_EMAILS)) {
    return bounce(res, origin, next, 'denied', dropState);
  }

  const session = createSession(identity.email, process.env.STATUSDOG_SESSION_SECRET);
  return bounce(res, origin, next, 'ok', [
    ...dropState,
    cookieHeader(SESSION_COOKIE, session, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      secure,
      sameSite: 'Lax',
    }),
  ]);
}
