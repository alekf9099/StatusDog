/**
 * Client-side URL tidying for the hire form.
 *
 * This is a courtesy, not a security control. The real validation is
 * `normalizeCheckUrl` on the server, which also rejects private address space —
 * anything typed here still goes through it. The point of doing a pass in the
 * browser is that "not a URL" should be a red line under the field, not a round
 * trip and a 400.
 */

/** Hosts that are pointless to monitor from a hosted checker. */
const OBVIOUSLY_LOCAL = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

/**
 * Turn what someone typed into a URL worth submitting, or `null` if it is not one.
 *
 * Accepts `example.com`, `example.com/health`, and full URLs. Strips the fragment,
 * which never reaches a server anyway and would only make two identical monitors
 * look different.
 */
export function normalizeUrlForDisplay(input) {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  // A hostname with no dot and no port is almost always a typo, not a host.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  if (OBVIOUSLY_LOCAL.test(url.hostname)) return null;
  if (url.username !== '' || url.password !== '') return null;

  url.hash = '';
  return url.toString();
}
