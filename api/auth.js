/**
 * `/api/auth/:action` — the whole Google sign-in flow in one function.
 *
 * Four routes behind one file, dispatched on `?action=`, because Vercel's Hobby
 * plan allows twelve serverless functions per deployment and one per OAuth step
 * would spend a third of that budget on sign-in. `vercel.json` rewrites the pretty
 * paths onto this, so the URLs are still `/api/auth/login` and friends — including
 * the redirect URI registered with Google.
 *
 * Order matters in `callback`, and it is deliberately strictest-first:
 *
 *   1. is the admin surface configured at all
 *   2. does the returned `state` match the cookie this browser was given
 *   3. does Google confirm the code, and is the address verified
 *   4. is that address on the owner's allowlist
 *
 * Only after all four does a session exist. Step 4 is the one that matters most:
 * step 3 proves who somebody is, and everyone on earth can pass it.
 *
 * Failures redirect back with a coarse reason code rather than rendering an error —
 * the difference between "wrong code" and "not on the list" is only useful to
 * somebody probing.
 */
import { authorizeUrl, exchangeCode, newState } from '../dist/auth/google.js';
import {
  adminConfigured,
  authorize,
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
} from '../dist/auth/session.js';
import { isLocalOrigin, originOf } from '../dist/util/origin.js';

/** Five minutes is more than enough to click one button. */
const STATE_TTL_SECONDS = 300;

function bounce(res, origin, next, reason, cookies) {
  res.setHeader('set-cookie', cookies);
  const separator = next.includes('?') ? '&' : '?';
  res
    .status(302)
    .setHeader('location', `${origin}${next}${separator}signin=${encodeURIComponent(reason)}`);
  res.end();
}

/**
 * Start the flow.
 *
 * `?next=` remembers which page the owner was on, so signing in from an incident
 * report comes back to that report. Only a path on this site is accepted — see
 * `safeNextPath`, because this parameter is how open redirects happen.
 */
function login(req, res, origin, query) {
  const state = newState();
  const next = safeNextPath(query.get('next'));
  const options = {
    maxAgeSeconds: STATE_TTL_SECONDS,
    secure: !isLocalOrigin(origin),
    // Google sends the browser back with a top-level GET, which Lax allows and
    // Strict would silently drop — taking the state cookie with it.
    sameSite: 'Lax',
  };

  res.setHeader('set-cookie', [
    cookieHeader(STATE_COOKIE, state, options),
    cookieHeader(NEXT_COOKIE, next, options),
  ]);
  res.status(302).setHeader('location', authorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID,
    redirectUri: `${origin}/api/auth/callback`,
    state,
  }));
  res.end();
}

async function callback(req, res, origin, query) {
  const secure = !isLocalOrigin(origin);
  const cookies = parseCookies(req.headers?.cookie);
  // Both flow cookies have done their job either way; neither survives this request.
  const dropFlow = [clearCookie(STATE_COOKIE, { secure }), clearCookie(NEXT_COOKIE, { secure })];
  const next = safeNextPath(cookies[NEXT_COOKIE]);

  const code = query.get('code');
  const state = query.get('state');
  const expected = cookies[STATE_COOKIE];

  // The user may simply have declined at Google's screen.
  if (query.get('error')) return bounce(res, origin, next, 'cancelled', dropFlow);
  if (!code || !state || !expected || state !== expected) {
    return bounce(res, origin, next, 'expired', dropFlow);
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
    return bounce(res, origin, next, 'failed', dropFlow);
  }

  // Authenticated, but that is not the same as authorized.
  if (!isAllowed(identity.email, process.env.STATUSDOG_ADMIN_EMAILS)) {
    return bounce(res, origin, next, 'denied', dropFlow);
  }

  const session = createSession(identity.email, process.env.STATUSDOG_SESSION_SECRET);
  return bounce(res, origin, next, 'ok', [
    ...dropFlow,
    cookieHeader(SESSION_COOKIE, session, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      secure,
      sameSite: 'Lax',
    }),
  ]);
}

/**
 * Sign out.
 *
 * POST only, so a link or an image on another page cannot sign the owner out. A
 * nuisance rather than a breach, but still a bug.
 *
 * Sessions are stateless signed cookies, so this clears the browser's copy. To
 * revoke everything everywhere — a lost laptop — rotate
 * `STATUSDOG_SESSION_SECRET`, which invalidates every session at once.
 */
function logout(req, res, origin) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Use POST to sign out.' });
    return;
  }
  res.setHeader('set-cookie', clearCookie(SESSION_COOKIE, { secure: !isLocalOrigin(origin) }));
  res.status(200).json({ signedIn: false });
}

/**
 * Who is asking, and may they write?
 *
 * The UI needs this to decide between an edit box and a sign-in link. It reports the
 * signed-in address back to the browser that already holds the session cookie, and
 * nothing to anyone else. `configured: false` is how the UI knows to hide the admin
 * affordances entirely rather than offering a sign-in that cannot work.
 */
function me(req, res) {
  const auth = authorize(req.headers?.cookie, process.env);
  res.status(200).json({
    configured: adminConfigured(process.env),
    signedIn: auth.ok,
    email: auth.ok ? auth.email : null,
    reason: auth.reason,
  });
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const url = new URL(req.url ?? '/', 'http://localhost');
  const query = url.searchParams;
  // The rewrite supplies `action`; the path is the fallback for a direct call.
  const action = query.get('action') ?? url.pathname.split('/').filter(Boolean).pop();

  // `me` answers before this, because the UI has to be able to ask "is there an
  // admin surface at all" and get a useful `configured: false` rather than a 503.
  if (action === 'me') return me(req, res);

  if (!adminConfigured(process.env)) {
    res.status(503).json({
      error: 'The admin surface is not configured, so sign-in is closed.',
      hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, STATUSDOG_SESSION_SECRET and STATUSDOG_ADMIN_EMAILS.',
    });
    return;
  }

  const origin = originOf(req, process.env);
  switch (action) {
    case 'login':
      return login(req, res, origin, query);
    case 'callback':
      return callback(req, res, origin, query);
    case 'logout':
      return logout(req, res, origin);
    default:
      res.status(404).json({ error: 'Unknown auth action.' });
  }
}
