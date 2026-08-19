import type { ExpectStatus } from '../config/types.js';

/**
 * Does `status` satisfy any of the expectations?
 *
 * Accepted forms: `200` / `"200"` (exact), `"2xx"` (class), `"200-299"` (range),
 * `"*"` (anything).
 */
export function statusMatches(status: number, expectations: ExpectStatus[]): boolean {
  return expectations.some((expectation) => matchesOne(status, expectation));
}

function matchesOne(status: number, expectation: ExpectStatus): boolean {
  if (typeof expectation === 'number') return status === expectation;

  const text = String(expectation).trim().toLowerCase();
  if (text === '' ) return false;
  if (text === '*' || text === 'any') return true;

  const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(text);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    return status >= Math.min(low, high) && status <= Math.max(low, high);
  }

  const klass = /^([1-5])xx$/.exec(text);
  if (klass) return Math.floor(status / 100) === Number(klass[1]);

  const exact = /^\d{3}$/.exec(text);
  if (exact) return status === Number(text);

  return false;
}

/** Describe the expectations for error messages: `2xx, 3xx`. */
export function describeExpectations(expectations: ExpectStatus[]): string {
  return expectations.map(String).join(', ');
}

/** Does the response body satisfy `expectBody`? */
export function bodyMatches(body: string, expected: string, isRegex: boolean): boolean {
  if (!isRegex) return body.includes(expected);
  try {
    return new RegExp(expected).test(body);
  } catch {
    // An unusable pattern should surface as a failed check rather than a crash.
    return false;
  }
}
