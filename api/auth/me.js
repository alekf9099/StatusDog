/**
 * `GET /api/auth/me` — is whoever is asking an owner?
 *
 * The UI needs this to decide whether to show an edit box or a sign-in link. It
 * reports the signed-in address back to the browser that already holds the session
 * cookie, and nothing to anyone else.
 *
 * `configured: false` is how the UI knows to hide the admin affordances entirely
 * rather than offering a sign-in that cannot work.
 */
import { adminConfigured, authorize } from '../../dist/auth/session.js';

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  const configured = adminConfigured(process.env);
  const auth = authorize(req.headers?.cookie, process.env);

  res.status(200).json({
    configured,
    signedIn: auth.ok,
    // Only ever the caller's own address, and only when it is the valid session.
    email: auth.ok ? auth.email : null,
    reason: auth.reason,
  });
}
