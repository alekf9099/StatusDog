/**
 * What a site's security looks like from outside — and only from outside.
 *
 * StatusDog is a visitor. It cannot see attacks against a site: who else is
 * knocking, with what payload, is in the site's own access logs and firewall, and
 * any "attacks blocked" figure produced here would be invented. What a visitor
 * *can* see, on the responses it already receives, is:
 *
 *   - **hardening headers** — HSTS, CSP, framing, MIME sniffing, referrer policy;
 *   - **software versions** given away in `Server` / `X-Powered-By`;
 *   - **what the home page loads from elsewhere** — a script from a host that was
 *     never there before is how card skimmers and injected redirects arrive;
 *   - **defacement** text;
 *   - **certificate changes**, and (see ct.ts) certificates issued for the domain.
 *
 * Everything here is passive: it reads responses the scheduler fetched anyway and
 * sends nothing a normal visitor would not. Probing for exposed files (`/.env`,
 * `/.git/HEAD`) is deliberately absent — that is a vulnerability scan, it shows up
 * in the target's firewall as an attack, and it needs its owner's security team to
 * agree first.
 *
 * Findings are owner-only. Every fact here is public, but a curated list of a
 * site's weak points on a public status page would be a gift to an attacker.
 *
 * Alerts fire on *changes*, never on a standing state: a header that has always
 * been missing is a to-do item for the tab, while one that disappears in a deploy
 * is news.
 */

export type CheckLevel = 'pass' | 'warn' | 'info';

export type HeaderCheckId =
  | 'hsts'
  | 'csp'
  | 'framing'
  | 'nosniff'
  | 'referrer'
  | 'permissions'
  | 'version';

export interface HeaderCheck {
  id: HeaderCheckId;
  level: CheckLevel;
  /** The header value that decided it, or `null` when it is absent. */
  value: string | null;
  /** A short machine-readable qualifier, e.g. `short-max-age`, `php-eol`. */
  note: string | null;
}

/** 180 days — the floor most guidance (and browser preload lists) set for HSTS. */
export const HSTS_MIN_MAX_AGE = 180 * 86_400;

/**
 * Oldest PHP release line still receiving security fixes.
 *
 * A date-bound fact, so it is written down with its date: as of October 2026, 8.1
 * reached end of life on 31 December 2025 and 8.2 is supported to 31 December
 * 2026. Raise this when 8.2 ends. https://www.php.net/supported-versions.php
 */
export const PHP_SUPPORTED_FROM: [number, number] = [8, 2];

const VERSIONED = /\b([A-Za-z][\w.-]*)\/(\d+(?:\.\d+)*)/;

function header(headers: Record<string, string> | null | undefined, name: string): string | null {
  const value = headers?.[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Judge the hardening headers of one response. */
export function assessHeaders(
  headers: Record<string, string> | null | undefined,
  finalUrl: string,
): HeaderCheck[] {
  const https = finalUrl.startsWith('https:');
  const checks: HeaderCheck[] = [];
  const csp = header(headers, 'content-security-policy');

  // HSTS only means anything over https; on plain http there is a bigger problem.
  const hsts = header(headers, 'strict-transport-security');
  if (!https) {
    checks.push({ id: 'hsts', level: 'warn', value: null, note: 'not-https' });
  } else if (!hsts) {
    checks.push({ id: 'hsts', level: 'warn', value: null, note: null });
  } else {
    const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? NaN);
    checks.push({
      id: 'hsts',
      level: Number.isFinite(maxAge) && maxAge >= HSTS_MIN_MAX_AGE ? 'pass' : 'warn',
      value: hsts,
      note: Number.isFinite(maxAge) && maxAge >= HSTS_MIN_MAX_AGE ? null : 'short-max-age',
    });
  }

  // A CSP that only upgrades requests restricts nothing a script can do.
  if (!csp) {
    checks.push({ id: 'csp', level: 'warn', value: null, note: null });
  } else {
    const restricts = /(?:^|;)\s*(?:default-src|script-src)\b/i.test(csp);
    checks.push({ id: 'csp', level: restricts ? 'pass' : 'warn', value: csp, note: restricts ? null : 'no-script-policy' });
  }

  // Either header stops another site framing this one for clickjacking.
  const xfo = header(headers, 'x-frame-options');
  const ancestors = csp ? /(?:^|;)\s*frame-ancestors\b[^;]*/i.exec(csp)?.[0]?.trim() ?? null : null;
  const framingOk = (xfo && /^(?:deny|sameorigin)$/i.test(xfo)) || ancestors !== null;
  checks.push({ id: 'framing', level: framingOk ? 'pass' : 'warn', value: xfo ?? ancestors, note: null });

  const nosniff = header(headers, 'x-content-type-options');
  checks.push({
    id: 'nosniff',
    level: nosniff && /^nosniff$/i.test(nosniff) ? 'pass' : 'warn',
    value: nosniff,
    note: null,
  });

  // Good practice rather than a hole: reported, but never as a warning.
  const referrer = header(headers, 'referrer-policy');
  checks.push({ id: 'referrer', level: referrer ? 'pass' : 'info', value: referrer, note: null });
  const permissions = header(headers, 'permissions-policy');
  checks.push({ id: 'permissions', level: permissions ? 'pass' : 'info', value: permissions, note: null });

  checks.push(assessVersion(headers));
  return checks;
}

/**
 * Software versions handed to every visitor.
 *
 * `Server: nginx` is harmless; `Server: nginx/1.18.0` tells an attacker which
 * published vulnerabilities to try first. An unsupported PHP line is called out
 * by name, because that one stops getting security fixes entirely.
 */
function assessVersion(headers: Record<string, string> | null | undefined): HeaderCheck {
  for (const name of ['x-powered-by', 'server']) {
    const value = header(headers, name);
    const match = value ? VERSIONED.exec(value) : null;
    if (!value || !match) continue;
    const [, product, version] = match;
    if (/^php$/i.test(product!)) {
      const [major = 0, minor = 0] = version!.split('.').map(Number);
      const [okMajor, okMinor] = PHP_SUPPORTED_FROM;
      if (major < okMajor || (major === okMajor && minor < okMinor)) {
        return { id: 'version', level: 'warn', value, note: 'php-eol' };
      }
    }
    return { id: 'version', level: 'warn', value, note: 'disclosed' };
  }
  return { id: 'version', level: 'pass', value: header(headers, 'server'), note: null };
}

/* ---------------- what the home page loads from elsewhere ---------------- */

export interface ExternalSource {
  origin: string;
  kind: 'script' | 'iframe';
}

/**
 * Hosts the page pulls scripts and frames from, other than its own.
 *
 * Origins rather than full URLs: a file name with a build hash changes on every
 * deploy, and alerting on that would bury the one change that matters — a host
 * that has never been there before.
 */
export function externalSources(html: string | null | undefined, baseUrl: string): ExternalSource[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found = new Map<string, ExternalSource>();
  const tag = /<(script|iframe)\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\2[^>]*>/gi;
  for (const match of String(html ?? '').matchAll(tag)) {
    let url: URL;
    try {
      url = new URL(match[3]!.trim(), base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.origin === base.origin) continue;
    const kind = match[1]!.toLowerCase() as ExternalSource['kind'];
    const key = `${kind} ${url.origin}`;
    if (!found.has(key)) found.set(key, { origin: url.origin, kind });
  }
  return [...found.values()];
}

/**
 * Text that only a defaced page carries.
 *
 * Narrow on purpose. A phrase like "owned by" appears in copyright footers; these
 * do not appear on a working commercial site.
 */
const DEFACEMENT = /\b(?:h[a4]ck(?:e|3)d\s+by|defaced\s+by|was\s+h[a4]ck(?:e|3)d|greetz\s+to)\b/i;

export function findDefacement(visible: string): string | null {
  const match = DEFACEMENT.exec(visible);
  if (!match) return null;
  const start = Math.max(0, match.index - 20);
  return visible.slice(start, match.index + match[0].length + 40).trim();
}

/* ---------------- state across runs ---------------- */

export interface KnownSource extends ExternalSource {
  firstSeen: string;
  lastSeen: string;
}

export interface CertSeen {
  issuer: string | null;
  fingerprint: string | null;
  validTo: string | null;
  /** When the certificate last changed, and from which issuer. */
  changedAt: string | null;
  previousIssuer: string | null;
}

export interface SecurityState {
  observedAt: string | null;
  headers: HeaderCheck[];
  /** The first observation — sources seen then are the baseline, not news. */
  baselineAt: string | null;
  sources: KnownSource[];
  defacement: { at: string; excerpt: string } | null;
  cert: CertSeen | null;
}

export const EMPTY_SECURITY: SecurityState = {
  observedAt: null,
  headers: [],
  baselineAt: null,
  sources: [],
  defacement: null,
  cert: null,
};

/** A source unseen this long is forgotten; until then, its coming back is not news. */
export const SOURCE_FORGET_MS = 30 * 86_400_000;
const MAX_SOURCES = 50;

export interface SecurityObservation {
  at: string;
  finalUrl: string;
  headers: Record<string, string> | null;
  /** The home page body, or `null` when none was read. */
  body: string | null;
  /** Visible text of that body, for the defacement check. */
  visible: string;
  tls: { issuer: string | null; fingerprint: string | null; validTo: string | null } | null;
}

export type SecurityFindingKind = 'header-lost' | 'new-source' | 'defacement' | 'issuer-changed';

export interface SecurityFinding {
  kind: SecurityFindingKind;
  severity: 'info' | 'warning' | 'critical';
  /** What changed, for the alert line: a header id, an origin, an excerpt, an issuer. */
  subject: string;
  detail: string | null;
}

export function nextSecurity(
  previous: SecurityState | null | undefined,
  observation: SecurityObservation,
): { state: SecurityState; findings: SecurityFinding[] } {
  const prev = previous ?? EMPTY_SECURITY;
  const at = observation.at;
  const findings: SecurityFinding[] = [];
  const first = prev.baselineAt === null;

  // Headers: only a regression is news.
  const headers = assessHeaders(observation.headers, observation.finalUrl);
  if (!first) {
    const before = new Map(prev.headers.map((check) => [check.id, check.level]));
    for (const check of headers) {
      if (before.get(check.id) === 'pass' && check.level === 'warn') {
        findings.push({ kind: 'header-lost', severity: 'warning', subject: check.id, detail: check.value });
      }
    }
  }

  // External sources: a host never seen before.
  const now = Date.parse(at);
  const known = new Map(prev.sources.map((source) => [`${source.kind} ${source.origin}`, source]));
  const seen = observation.body === null ? [] : externalSources(observation.body, observation.finalUrl);
  for (const source of seen) {
    const key = `${source.kind} ${source.origin}`;
    const existing = known.get(key);
    if (existing) {
      known.set(key, { ...existing, lastSeen: at });
      continue;
    }
    known.set(key, { ...source, firstSeen: at, lastSeen: at });
    if (!first) {
      findings.push({ kind: 'new-source', severity: 'warning', subject: source.origin, detail: source.kind });
    }
  }
  const sources = [...known.values()]
    .filter((source) => now - Date.parse(source.lastSeen) < SOURCE_FORGET_MS)
    .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))
    .slice(-MAX_SOURCES);

  // Defacement: reported when it appears, remembered while it stays.
  const excerpt = findDefacement(observation.visible);
  let defacement = prev.defacement;
  if (excerpt && !prev.defacement) {
    defacement = { at, excerpt };
    findings.push({ kind: 'defacement', severity: 'critical', subject: excerpt, detail: null });
  } else if (!excerpt) {
    defacement = null;
  }

  // Certificate: a renewal from the same issuer is routine; a new issuer is not.
  const tls = observation.tls;
  let cert = prev.cert;
  if (tls && (tls.fingerprint || tls.issuer)) {
    if (!cert) {
      cert = { ...tls, changedAt: null, previousIssuer: null };
    } else if (tls.fingerprint !== cert.fingerprint) {
      const issuerChanged = Boolean(cert.issuer && tls.issuer && tls.issuer !== cert.issuer);
      if (issuerChanged) {
        findings.push({ kind: 'issuer-changed', severity: 'warning', subject: tls.issuer!, detail: cert.issuer });
      }
      cert = { ...tls, changedAt: at, previousIssuer: cert.issuer };
    } else {
      cert = { ...cert, validTo: tls.validTo };
    }
  }

  return {
    state: {
      observedAt: at,
      headers,
      baselineAt: prev.baselineAt ?? at,
      sources,
      defacement,
      cert,
    },
    findings,
  };
}

/** One line per finding, in the shape of the other alerts. */
export function describeSecurityFinding(
  target: { name: string; url: string },
  finding: SecurityFinding,
): string {
  const where = `${target.name} (${target.url})`;
  switch (finding.kind) {
    case 'header-lost':
      return `Security: ${where} — the ${HEADER_NAMES[finding.subject as HeaderCheckId] ?? finding.subject} protection is no longer in place`;
    case 'new-source':
      return `Security: ${where} — the home page now loads a ${finding.detail ?? 'script'} from a host never seen before: ${finding.subject}`;
    case 'defacement':
      return `Security: ${where} — the home page contains defacement text: "${finding.subject}"`;
    case 'issuer-changed':
      return `Security: ${where} — the TLS certificate is now issued by ${finding.subject} (was ${finding.detail ?? 'unknown'})`;
  }
}

const HEADER_NAMES: Record<HeaderCheckId, string> = {
  hsts: 'Strict-Transport-Security',
  csp: 'Content-Security-Policy',
  framing: 'anti-framing (X-Frame-Options / frame-ancestors)',
  nosniff: 'X-Content-Type-Options',
  referrer: 'Referrer-Policy',
  permissions: 'Permissions-Policy',
  version: 'version-hiding',
};
