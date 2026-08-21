/**
 * `GET /api/auth/login` — start the Google sign-in flow.
 *
 * Redirects to Google with an unguessable `state`, which is also dropped in a
 * short-lived cookie so the callback can prove it is finishing the same flow this
 * browser started.
 *
 * `?next=` remembers which page the owner was on, so signing in from an incident
 * report comes back to that report. Only a path on this site is accepted — see
 * `safeNextPath`, because this parameter is how open redirects happen.
 *
 * With the admin environment unconfigured this returns 503 and explains what is
 * missing. It does not offer a degraded sign-in: an admin surface that fails open
 * would be worse than not having one.
 */
import { authorizeUrl, newState } from '../../dist/auth/google.js';
import {
  adminConfigured,
  cookieHeader,
  NEXT_COOKIE,
  safeNextPath,
  STATE_COOKIE,
} from '../../dist/auth/session.js';
import { isLocalOrigin, originOf } from '../../dist/util/origin.js';

/** Five minutes is more than enough to click one button. */
const STATE_TTL_SECONDS = 300;

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if (!adminConfigured(process.env)) {
    res.status(503).json({
      error: 'The admin surface is not configured, so sign-in is closed.',
      hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, STATUSDOG_SESSION_SECRET and STATUSDOG_ADMIN_EMAILS.',
    });
    return;
  }

  const origin = originOf(req, process.env);
  const state = newState();

  const next = safeNextPath(new URL(req.url ?? '/', 'http://localhost').searchParams.get('next'));
  const cookieOptions = {
    maxAgeSeconds: STATE_TTL_SECONDS,
    secure: !isLocalOrigin(origin),
    // Google sends the browser back with a top-level GET, which Lax allows and
    // Strict would silently drop — taking the state cookie with it.
    sameSite: 'Lax',
  };

  res.setHeader('set-cookie', [
    cookieHeader(STATE_COOKIE, state, cookieOptions),
    cookieHeader(NEXT_COOKIE, next, cookieOptions),
  ]);

  res.status(302).setHeader('location', authorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID,
    redirectUri: `${origin}/api/auth/callback`,
    state,
  }));
  res.end();
}
