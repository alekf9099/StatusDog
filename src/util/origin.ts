/**
 * Where this deployment thinks it lives.
 *
 * A serverless function does not know its own hostname, and three things now need
 * one: the feed has to state its own address, OAuth has to hand Google a redirect
 * URI, and the CSRF check has to know what a same-origin request looks like.
 *
 * The host header is caller-controlled, so it is validated to a hostname shape
 * before use rather than trusted. `STATUSDOG_SITE_URL` overrides it, which is the
 * right answer for anything security-sensitive: an attacker who can set the host
 * header cannot change a value that is not read from the request.
 */

const FALLBACK = 'https://status-dog.vercel.app';

export interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
}

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '').split(',')[0]!.trim();
}

export function originOf(
  req: RequestLike,
  env: Record<string, string | undefined> = {},
): string {
  const configured = env.STATUSDOG_SITE_URL;
  if (configured) return String(configured).replace(/\/+$/, '');

  const host = firstHeader(req.headers?.['x-forwarded-host']) || firstHeader(req.headers?.host);
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return FALLBACK;

  const proto = firstHeader(req.headers?.['x-forwarded-proto']);
  const local = host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
  const scheme = proto === 'http' || local ? 'http' : 'https';
  return `${scheme}://${host}`;
}

/** Cookies may only skip `Secure` where there is no https to be secure on. */
export function isLocalOrigin(origin: string): boolean {
  return origin.startsWith('http://127.0.0.1')
    || origin.startsWith('http://localhost')
    || origin.startsWith('http://[::1]');
}
