/**
 * Certificates issued for a site's domain, from the public Certificate
 * Transparency logs.
 *
 * Every publicly trusted certificate must be logged, so these logs show
 * certificates the site's owners did not ask for: one from a certificate
 * authority the company has never used, or for a host name nobody recognises.
 * Neither proves an attack — a team may have switched providers or launched a
 * subdomain — but both are things an owner would want to hear about from their
 * monitor rather than from someone else.
 *
 * Queried through crt.sh once a day per domain. It is a free community service
 * that is sometimes slow, so a failed lookup is retried an hour later and never
 * affects the check it rides along with.
 */

export const CT_INTERVAL_MS = 24 * 3_600_000;
export const CT_RETRY_MS = 3_600_000;
const CT_TIMEOUT_MS = 15_000;
const CT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SEEN = 500;
const MAX_RECENT = 10;

/**
 * Suffixes under which unrelated parties own sibling names. Querying the whole
 * suffix would report every other customer's certificates as if they were ours,
 * so under these only the exact host is looked up.
 */
const SHARED_SUFFIXES = [
  'vercel.app', 'netlify.app', 'github.io', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'web.app', 'firebaseapp.com',
];
/** Two-label public suffixes common enough to matter here (e.g. example.co.kr). */
const SECOND_LEVEL = /^(?:co|or|go|ac|ne|re|pe|com|net|org|gov|edu)\.[a-z]{2}$/;

/**
 * What to ask the logs about for a host: its registrable domain with all
 * subdomains (`%.copykiller.com`), or just the host on a shared platform.
 */
export function ctQuery(host: string): { domain: string; pattern: string } {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (/^\d+(?:\.\d+){3}$/.test(name) || name.includes(':') || !name.includes('.')) {
    return { domain: name, pattern: name };
  }
  for (const suffix of SHARED_SUFFIXES) {
    if (name === suffix || name.endsWith(`.${suffix}`)) return { domain: name, pattern: name };
  }
  const labels = name.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const domain = SECOND_LEVEL.test(lastTwo) && labels.length >= 3 ? labels.slice(-3).join('.') : lastTwo;
  return { domain, pattern: `%.${domain}` };
}

export interface CtEntry {
  id: number;
  issuerOrg: string;
  names: string[];
  notBefore: string | null;
}

/** crt.sh's JSON rows, reduced to what is compared. Malformed rows are skipped. */
export function parseCrtSh(json: unknown): CtEntry[] {
  if (!Array.isArray(json)) return [];
  const out: CtEntry[] = [];
  for (const row of json) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    const issuer = String(r.issuer_name ?? '');
    // The organisation, not the intermediate's name: "Amazon RSA 2048 M01" and
    // "M04" are the same company rotating intermediates, not a new issuer.
    const issuerOrg = /(?:^|,\s*)O=("?)([^,"]+)\1/.exec(issuer)?.[2]?.trim()
      ?? /(?:^|,\s*)CN=([^,]+)/.exec(issuer)?.[1]?.trim()
      ?? 'unknown';
    const names = [...new Set(String(r.name_value ?? '').split(/\s+/).map((n) => n.toLowerCase()).filter(Boolean))];
    out.push({ id, issuerOrg, names, notBefore: typeof r.not_before === 'string' ? r.not_before : null });
  }
  return out;
}

export interface CtRecent {
  id: number;
  issuerOrg: string;
  names: string[];
  notBefore: string | null;
  firstSeen: string;
  newIssuer: boolean;
  newNames: string[];
}

export interface CtState {
  domain: string;
  checkedAt: string | null;
  attemptedAt: string | null;
  error: string | null;
  issuers: string[];
  names: string[];
  seenIds: number[];
  recent: CtRecent[];
}

export function ctDue(state: CtState | null | undefined, domain: string, now: number): boolean {
  if (!state || state.domain !== domain) return true;
  if (state.error) return !state.attemptedAt || now - Date.parse(state.attemptedAt) >= CT_RETRY_MS;
  return !state.checkedAt || now - Date.parse(state.checkedAt) >= CT_INTERVAL_MS;
}

export type CtFindingKind = 'ct-new-issuer' | 'ct-new-name';

export interface CtFinding {
  kind: CtFindingKind;
  severity: 'info' | 'warning';
  subject: string;
  certId: number;
}

/**
 * Fold one lookup into the state. The first successful lookup is the baseline:
 * every certificate already there is history, not news.
 */
export function nextCt(
  previous: CtState | null | undefined,
  domain: string,
  entries: CtEntry[],
  at: string,
): { state: CtState; findings: CtFinding[] } {
  const prev = previous && previous.domain === domain ? previous : null;
  const first = !prev || prev.checkedAt === null;
  const issuers = new Set(prev?.issuers ?? []);
  const names = new Set(prev?.names ?? []);
  const seen = new Set(prev?.seenIds ?? []);
  const findings: CtFinding[] = [];
  const recent = [...(prev?.recent ?? [])];

  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const newIssuer = !first && !issuers.has(entry.issuerOrg);
    const newNames = first ? [] : entry.names.filter((name) => !names.has(name));
    issuers.add(entry.issuerOrg);
    for (const name of entry.names) names.add(name);
    if (first) continue;

    recent.push({ ...entry, firstSeen: at, newIssuer, newNames });
    if (newIssuer) {
      findings.push({ kind: 'ct-new-issuer', severity: 'warning', subject: entry.issuerOrg, certId: entry.id });
    }
    for (const name of newNames) {
      findings.push({ kind: 'ct-new-name', severity: 'info', subject: name, certId: entry.id });
    }
  }

  return {
    state: {
      domain,
      checkedAt: at,
      attemptedAt: at,
      error: null,
      issuers: [...issuers].sort(),
      names: [...names].sort(),
      seenIds: [...seen].sort((a, b) => a - b).slice(-MAX_SEEN),
      recent: recent.slice(-MAX_RECENT),
    },
    findings,
  };
}

/** A failed lookup keeps everything known and only records the attempt. */
export function failedCt(previous: CtState | null | undefined, domain: string, at: string, error: string): CtState {
  const prev = previous && previous.domain === domain ? previous : null;
  return {
    domain,
    checkedAt: prev?.checkedAt ?? null,
    attemptedAt: at,
    error,
    issuers: prev?.issuers ?? [],
    names: prev?.names ?? [],
    seenIds: prev?.seenIds ?? [],
    recent: prev?.recent ?? [],
  };
}

/** Look the pattern up on crt.sh. Throws on any failure; the caller records it. */
export async function fetchCt(pattern: string, fetcher: typeof fetch = fetch): Promise<CtEntry[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent(pattern)}&output=json&exclude=expired`;
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(CT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`crt.sh responded ${response.status}`);
  const text = await response.text();
  if (text.length > CT_MAX_BYTES) throw new Error('crt.sh response too large');
  return parseCrtSh(JSON.parse(text));
}

export function describeCtFinding(domain: string, finding: CtFinding): string {
  const link = `https://crt.sh/?id=${finding.certId}`;
  return finding.kind === 'ct-new-issuer'
    ? `Security: a certificate for ${domain} was issued by ${finding.subject}, a certificate authority not seen for this domain before (${link})`
    : `Security: a certificate was issued for a new host name, ${finding.subject} (${link})`;
}
