/**
 * `/api/auth/:action` — the whole Google sign-in flow in one function.
 *
 * Four routes behind one file, dispatched on `?action=`, because Vercel's Hobby
 * plan allows twelve serverless functions per deployment and one per OAuth step
 * would spend a third of that budget on sign-in. `vercel.json` rewrites the pretty
 * paths onto this, so the URLs are still `/api/auth/login` and friends — including
 * the redirect URI registered with Google.
 *
 * Anyone with a Google account can sign in, and signing in is all it takes to
 * have an account: their own monitors are kept under it (`monitors`, below).
 * Being signed in is not being an owner. Owner rights are decided per request by
 * `authorize`, against STATUSDOG_ADMIN_EMAILS, every time — a session proves who
 * somebody is, and everyone on earth can get one.
 *
 * Order matters in `callback`, and it is deliberately strictest-first:
 *
 *   1. is sign-in configured at all
 *   2. does the returned `state` match the cookie this browser was given
 *   3. does Google confirm the code, and is the address verified
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
  identify,
  loginConfigured,
  NEXT_COOKIE,
  parseCookies,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  STATE_COOKIE,
  sameOriginWrite,
} from '../dist/auth/session.js';
import {
  addMonitor,
  MemberError,
  memberKey,
  publicView,
  readAccount,
  removeMonitor,
  writeAccount,
} from '../dist/store/members.js';
import { kvFromEnv } from '../dist/store/kv.js';
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

  // Authenticated is all a session means. Whether this address may do owner
  // things is asked again, of the allowlist, on every owner request.
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
  const email = identify(req.headers?.cookie, process.env);
  const auth = authorize(req.headers?.cookie, process.env);
  res.status(200).json({
    configured: loginConfigured(process.env),
    signedIn: email !== null,
    // Owner controls follow this, never `signedIn`.
    owner: auth.ok,
    ownerConfigured: adminConfigured(process.env),
    email,
    reason: auth.reason,
  });
}

/** A JSON body, at most 16 KB; anything else is an empty object. */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16_384) return {};
      chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    return {};
  }
}

const MEMBER_ERRORS = {
  'invalid-url': 400,
  'invalid-expect': 400,
  duplicate: 409,
  'member-limit': 403,
  'total-limit': 403,
  'not-found': 404,
};

/**
 * The signed-in person's own monitors.
 *
 *   GET                         the list, with the limits
 *   POST { op: 'add', url, type, expect, name }
 *   POST { op: 'remove', id }
 *   POST { op: 'import', items: [{ url, type, expect, name }] }   up to the limit; reports each
 *
 * Writes carry the same two cross-site barriers as every other write here: the
 * Origin must be this site, and a custom header must be present.
 */
async function monitors(req, res, origin) {
  const email = identify(req.headers?.cookie, process.env);
  if (!email) {
    res.status(401).json({ error: 'Sign in to keep monitors on your account.' });
    return;
  }
  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({ error: 'No key-value store is configured, so nothing can be saved.' });
    return;
  }
  const key = memberKey(email, process.env.STATUSDOG_SESSION_SECRET);
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    const { doc, index } = await readAccount(kv, key);
    res.status(200).json(publicView(doc, index));
    return;
  }
  if (method !== 'POST') {
    res.status(405).json({ error: 'Use GET or POST.' });
    return;
  }
  if (!sameOriginWrite(req.headers ?? {}, origin)) {
    res.status(403).json({ error: 'Cross-site request refused.' });
    return;
  }

  const body = await readJson(req);
  let { doc, index } = await readAccount(kv, key);
  try {
    if (body.op === 'add') {
      ({ doc, index } = addMonitor(doc, index, key, body));
    } else if (body.op === 'remove') {
      ({ doc, index } = removeMonitor(doc, index, key, String(body.id ?? '')));
    } else if (body.op === 'import') {
      // Each item on its own: one bad address should not stop the others moving.
      const results = [];
      for (const item of Array.isArray(body.items) ? body.items.slice(0, 20) : []) {
        try {
          const added = addMonitor(doc, index, key, item);
          ({ doc, index } = added);
          results.push({ url: item?.url ?? null, id: added.monitor.id, ok: true });
        } catch (err) {
          results.push({ url: item?.url ?? null, ok: false, code: err instanceof MemberError ? err.code : 'error' });
        }
      }
      await writeAccount(kv, key, doc, index);
      res.status(200).json({ ...publicView(doc, index), results });
      return;
    } else {
      res.status(400).json({ error: 'Unknown operation.' });
      return;
    }
  } catch (err) {
    if (err instanceof MemberError) {
      res.status(MEMBER_ERRORS[err.code] ?? 400).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  await writeAccount(kv, key, doc, index);
  res.status(200).json(publicView(doc, index));
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

  if (!loginConfigured(process.env)) {
    res.status(503).json({
      error: 'Sign-in is not configured.',
      hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and STATUSDOG_SESSION_SECRET.',
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
    case 'monitors':
      return monitors(req, res, origin);
    default:
      res.status(404).json({ error: 'Unknown auth action.' });
  }
}
