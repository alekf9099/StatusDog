import type { IncomingHttpHeaders } from 'node:http';

/**
 * Assertions beyond "did it answer 200".
 *
 * Each one exists because a 200 is not the same as a working site:
 *
 * - **Forbidden text** catches the half-broken page. A reverse proxy erroring, a
 *   stack trace rendered into the template, or a maintenance notice somebody forgot
 *   to remove all return 200 with the bad news in the body.
 * - **Header expectations** catch security headers quietly disappearing — an HSTS
 *   or CSP header dropped in a config change is invisible to every other check.
 * - **Redirect expectations** catch the chain changing shape: an interstitial
 *   added, an https upgrade lost, a redirect pointed somewhere new.
 *
 * All three run on data the probe already collects, so they cost nothing per check.
 */

/** Which forbidden pattern matched, or `null` if none did. */
export function findForbidden(
  body: string,
  patterns: string[],
  isRegex: boolean,
): string | null {
  for (const pattern of patterns) {
    if (pattern === '') continue;
    if (isRegex) {
      try {
        // Case-insensitive: "error" and "Error" are the same bad news.
        if (new RegExp(pattern, 'i').test(body)) return pattern;
      } catch {
        // An unusable pattern must not pass silently, but it also must not throw
        // mid-check. Treat it as not matching and let the config test catch it.
        continue;
      }
    } else if (body.toLowerCase().includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * `true` means the header must be present; a string means it must contain that
 * text, compared case-insensitively.
 */
export type HeaderExpectation = true | string;

export interface HeaderMismatch {
  name: string;
  expected: HeaderExpectation;
  /** `null` when the header was absent entirely. */
  actual: string | null;
}

/** The first expectation that is not met, or `null` when they all are. */
export function findHeaderMismatch(
  headers: IncomingHttpHeaders,
  expectations: Record<string, HeaderExpectation>,
): HeaderMismatch | null {
  for (const [rawName, expected] of Object.entries(expectations)) {
    const name = rawName.toLowerCase();
    const raw = headers[name];
    const actual = raw === undefined
      ? null
      : Array.isArray(raw)
        ? raw.join(', ')
        : String(raw);

    if (actual === null) return { name, expected, actual: null };
    if (expected === true) continue;
    if (!actual.toLowerCase().includes(String(expected).toLowerCase())) {
      return { name, expected, actual };
    }
  }
  return null;
}

/**
 * Normalise a URL enough to compare two of them.
 *
 * A trailing slash and a default port are not a redirect change, and treating them
 * as one would make the assertion useless.
 */
export function normalizeUrlForComparison(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.protocol}//${url.host}${path}${url.search}`.toLowerCase();
  } catch {
    return String(input ?? '').trim().toLowerCase();
  }
}

export function sameUrl(a: string, b: string): boolean {
  return normalizeUrlForComparison(a) === normalizeUrlForComparison(b);
}

/** Config may give one pattern or several; the engine always wants a list. */
export function toPatternList(input: unknown): string[] {
  if (typeof input === 'string') return input === '' ? [] : [input];
  if (Array.isArray(input)) {
    return input.filter((item): item is string => typeof item === 'string' && item !== '');
  }
  return [];
}
