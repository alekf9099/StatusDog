/**
 * `POST /api/auth/logout` — drop the session.
 *
 * POST rather than GET so a link or an image on another page cannot sign the owner
 * out. That is a nuisance rather than a breach, but a logout that any third-party
 * page can trigger is still a bug.
 *
 * Sessions are stateless signed cookies, so this clears the browser's copy. To
 * revoke everything everywhere — a lost laptop — rotate
 * `STATUSDOG_SESSION_SECRET`, which invalidates every session at once.
 */
import { clearCookie, SESSION_COOKIE } from '../../dist/auth/session.js';
import { isLocalOrigin, originOf } from '../../dist/util/origin.js';

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Use POST to sign out.' });
    return;
  }

  const secure = !isLocalOrigin(originOf(req, process.env));
  res.setHeader('set-cookie', clearCookie(SESSION_COOKIE, { secure }));
  res.status(200).json({ signedIn: false });
}
