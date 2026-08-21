import crypto from 'node:crypto';

/**
 * Google sign-in, without a library.
 *
 * The one design choice worth explaining: the ID token is verified by asking Google
 * rather than by checking the signature here. Local verification means fetching
 * JWKS, matching a key id, and running RSA verification — perfectly doable with
 * `node:crypto`, and a family of subtle mistakes (accepting `alg: none`, skipping
 * the audience check, ignoring expiry) that all look like working code.
 *
 * Signing in happens rarely — once a week per owner — so one extra round trip costs
 * nothing and removes that whole class of bug. If sign-in ever becomes hot, local
 * verification is the optimisation, not the starting point.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

/** Unguessable value tying a callback to the browser that started the flow. */
export function newState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface AuthorizeOptions {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function authorizeUrl(options: AuthorizeOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    // Nothing beyond identity is wanted, and asking for less is asking for less.
    scope: 'openid email',
    state: options.state,
    // The owner may well have several Google accounts; make the choice explicit
    // rather than silently reusing whichever one the browser is signed into.
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface VerifiedIdentity {
  email: string;
  emailVerified: boolean;
}

export interface ExchangeOptions {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable so the flow can be tested without reaching Google. */
  fetchImpl?: typeof fetch;
}

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Swap the authorization code for an identity.
 *
 * Every failure is a `GoogleAuthError` with a message safe to log. None of them are
 * shown to the browser in detail: a sign-in that failed is a sign-in that failed,
 * and the difference between "bad code" and "wrong audience" is only useful to
 * somebody probing.
 */
export async function exchangeCode(options: ExchangeOptions): Promise<VerifiedIdentity> {
  const doFetch = options.fetchImpl ?? fetch;

  const tokenResponse = await doFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenResponse.ok) {
    throw new GoogleAuthError(`Token exchange failed (${tokenResponse.status})`);
  }

  const token = (await tokenResponse.json()) as { id_token?: string };
  if (!token.id_token) throw new GoogleAuthError('No id_token in the token response');

  // Google validates the signature, expiry and audience for us.
  const infoResponse = await doFetch(
    `${TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(token.id_token)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!infoResponse.ok) {
    throw new GoogleAuthError(`Token verification failed (${infoResponse.status})`);
  }

  const info = (await infoResponse.json()) as {
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
  };

  // Belt and braces: tokeninfo checks the audience, and a mismatch here would mean
  // an ID token minted for a different application.
  if (info.aud !== options.clientId) {
    throw new GoogleAuthError('Token was issued for a different client');
  }
  if (!info.email) throw new GoogleAuthError('Token carries no email address');

  // The field comes back as the string "true" from this endpoint.
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (!verified) throw new GoogleAuthError('Email address is not verified');

  return { email: info.email.trim().toLowerCase(), emailVerified: true };
}
