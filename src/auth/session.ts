import crypto from 'node:crypto';

/**
 * Owner sessions.
 *
 * StatusDog has no user accounts and does not want any: everything the site shows
 * is public and read-only, and the only thing that needs an identity is *writing*.
 * So this is deliberately the smallest thing that can gate a write — a signed
 * cookie, no session store, no database table.
 *
 * Two ideas are kept strictly apart, because conflating them is how this kind of
 * feature goes wrong:
 *
 * - **Authentication** — Google says who you are. Everyone on earth has a Google
 *   account, so this alone grants nothing.
 * - **Authorization** — {@link isAllowed} checks that address against a list the
 *   deployment owner controls. That list is the actual gate, and it is re-checked on
 *   every request rather than baked into the cookie, so removing an address revokes
 *   access immediately instead of whenever the session happens to expire.
 *
 * With no list configured, nothing is authorized. An admin surface that fails open
 * would be worse than having none, which is where this project started.
 */

/** A week. Long enough not to be annoying, short enough to bound a leaked cookie. */
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;

export const SESSION_COOKIE = 'statusdog_session';
export const STATE_COOKIE = 'statusdog_oauth_state';
export const NEXT_COOKIE = 'statusdog_next';

/**
 * Where to send the browser after signing in.
 *
 * An open redirect is the classic way this parameter goes wrong: an attacker sends
 * a link that signs the owner in and bounces them to a lookalike site. Only a path
 * on this site is ever accepted — one leading slash, no second slash that would make
 * it protocol-relative, no scheme, no control characters.
 */
export function safeNextPath(input: unknown, fallback = '/dashboard'): string {
  const path = String(input ?? '');
  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//')) return fallback;
  if (path.length > 512) return fallback;
  if (/[\u0000-\u001F\u007F\\]/.test(path)) return fallback;
  return path;
}

export interface SessionPayload {
  /** The verified email address. */
  sub: string;
  /** Issued at, epoch ms. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Compare two strings without leaking where they differ. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which is itself not secret.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Parse the allowlist.
 *
 * Addresses are lowercased and trimmed because a Google account is the same account
 * however it is typed, and a case mismatch here would look like a mysterious
 * permission failure.
 */
export function adminEmails(raw: string | undefined | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** Is this address one of the owners? Never true when no list is configured. */
export function isAllowed(email: string | null | undefined, raw: string | undefined | null): boolean {
  const list = adminEmails(raw);
  if (list.length === 0) return false;
  const candidate = String(email ?? '').trim().toLowerCase();
  if (candidate === '') return false;
  return list.includes(candidate);
}

/**
 * Whether the admin surface exists at all.
 *
 * Every piece has to be present. A deployment missing any of them gets a clear 503
 * rather than a half-configured login that appears to work.
 */
export function adminConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.STATUSDOG_SESSION_SECRET
    && env.GOOGLE_CLIENT_ID
    && env.GOOGLE_CLIENT_SECRET
    && adminEmails(env.STATUSDOG_ADMIN_EMAILS).length > 0,
  );
}

export function createSession(email: string, secret: string, nowMs = Date.now()): string {
  const payload: SessionPayload = {
    sub: String(email).trim().toLowerCase(),
    iat: nowMs,
    exp: nowMs + SESSION_TTL_MS,
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Verify a session token and return who it belongs to.
 *
 * `null` for anything not provably valid: a bad signature, an expired token,
 * malformed input, or a missing secret. There is no partial success.
 */
export function readSession(
  token: string | null | undefined,
  secret: string | undefined | null,
  nowMs = Date.now(),
): SessionPayload | null {
  if (!token || !secret) return null;

  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  if (!encoded || !signature) return null;

  if (!sameSecret(signature, sign(encoded, secret))) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload?.sub !== 'string' || payload.sub === '') return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= nowMs) return null;
  return payload;
}

/* ---------------- cookies ---------------- */

/** Parse a Cookie header. Unknown or malformed pairs are simply skipped. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of String(header ?? '').split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index).trim();
    if (name === '') continue;
    try {
      out[name] = decodeURIComponent(pair.slice(index + 1).trim());
    } catch {
      // A cookie we cannot decode is a cookie we do not have.
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  /** Left off for localhost, where there is no https to be secure on. */
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict';
}

export function cookieHeader(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ];
  if (options.secure !== false) parts.push('Secure');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  return parts.join('; ');
}

export function clearCookie(name: string, options: CookieOptions = {}): string {
  return cookieHeader(name, '', { ...options, maxAgeSeconds: 0 });
}

/* ---------------- request-level checks ---------------- */

export interface AuthResult {
  ok: boolean;
  email: string | null;
  /** Why not, when `ok` is false. Safe to show: it never says which part matched. */
  reason: 'not-configured' | 'no-session' | 'not-allowed' | null;
}

/**
 * Who is making this request, and may they write?
 *
 * The allowlist is consulted here rather than trusted from the cookie, so an address
 * removed from the environment loses access on its next request.
 */
export function authorize(
  cookieHeaderValue: string | undefined | null,
  env: Record<string, string | undefined>,
  nowMs = Date.now(),
): AuthResult {
  if (!adminConfigured(env)) return { ok: false, email: null, reason: 'not-configured' };

  const session = readSession(
    parseCookies(cookieHeaderValue)[SESSION_COOKIE],
    env.STATUSDOG_SESSION_SECRET,
    nowMs,
  );
  if (!session) return { ok: false, email: null, reason: 'no-session' };

  if (!isAllowed(session.sub, env.STATUSDOG_ADMIN_EMAILS)) {
    return { ok: false, email: session.sub, reason: 'not-allowed' };
  }
  return { ok: true, email: session.sub, reason: null };
}

/**
 * Cross-site request forgery check for a state-changing request.
 *
 * The session lives in a cookie, so a page on another origin could otherwise make
 * the browser send it. Two independent barriers:
 *
 * - the `Origin` header must be this site — a cross-site form post carries the
 *   attacker's origin, and cannot forge this one;
 * - a custom header must be present, which a plain form cannot set at all and a
 *   script can only set after a CORS preflight this site never approves.
 */
export function sameOriginWrite(
  headers: Record<string, string | string[] | undefined>,
  expectedOrigin: string,
): boolean {
  const origin = String(headers.origin ?? '').split(',')[0]!.trim();
  if (origin === '' || origin !== expectedOrigin) return false;
  return String(headers['x-statusdog-admin'] ?? '') !== '';
}
