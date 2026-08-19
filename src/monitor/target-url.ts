/**
 * URL normalisation and safety checks for user-supplied targets.
 *
 * Anywhere StatusDog fetches a URL that someone else typed — the public
 * `/api/check` endpoint above all — it is a server-side request forgery gadget
 * unless private address space is off limits.
 */

export class UnsafeUrlError extends Error {
  override name = 'UnsafeUrlError';
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.internal', '.local'];

/**
 * Is this hostname inside address space a public checker has no business
 * reaching — loopback, link-local, private or multicast?
 *
 * Literal addresses and well-known names only. A public hostname whose DNS
 * record points at a private IP still gets through; closing that needs a
 * custom `lookup` that re-checks the resolved address before connecting.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '') return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10).
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true;            // "this network"
  if (a === 10) return true;           // private
  if (a === 127) return true;          // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a >= 224) return true;           // multicast and reserved
  return false;
}

/**
 * Turn user input into a URL safe to probe.
 *
 * Accepts `example.com` as well as a full URL. Throws {@link UnsafeUrlError}
 * with a message meant to be shown to whoever typed it.
 */
export function normalizeCheckUrl(raw: unknown): string {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '') {
    throw new UnsafeUrlError('A URL is required.');
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UnsafeUrlError(`"${trimmed}" is not a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs can be checked.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeUrlError('Credentials in the URL are not supported.');
  }
  if (isBlockedHost(url.hostname)) {
    throw new UnsafeUrlError('Private, loopback and link-local addresses cannot be checked.');
  }
  return url.toString();
}
