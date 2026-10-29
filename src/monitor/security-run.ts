/**
 * One run's security observation for one target: the home page's response, and —
 * once a day — the certificate logs. The rules live in security.ts and ct.ts.
 */

import type { ResolvedTarget } from '../config/types.js';
import type { TargetSecurity } from '../store/uptime.js';
import type { ProbeWithBody } from './probe.js';
import { visibleText } from './discover.js';
import { describeSecurityFinding, EMPTY_SECURITY, nextSecurity } from './security.js';
import { ctDue, ctQuery, describeCtFinding, failedCt, nextCt, type CtEntry } from './ct.js';

export interface SecurityAlert {
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  /**
   * The same change seen through two targets — `copykiller.com` redirecting to
   * `www`, both on one certificate domain — is one alert. Callers drop repeats of
   * a key within a run.
   */
  key: string;
  data: Record<string, unknown>;
}

export interface SecurityInput {
  target: ResolvedTarget;
  home: ProbeWithBody;
  /** A disputed or failed home check says nothing about the healthy page's headers. */
  conclusive: boolean;
  previous: TargetSecurity | null;
  at: string;
  /** Certificate log lookup; memoised per run by the caller so a domain is asked once. */
  ctLookup: (pattern: string) => Promise<CtEntry[]>;
}

export interface SecurityRun {
  /** `undefined` leaves the stored state untouched. */
  security: TargetSecurity | undefined;
  alerts: SecurityAlert[];
}

export async function observeSecurity(input: SecurityInput): Promise<SecurityRun> {
  const { target, home, previous, at } = input;
  const result = home.result;
  const alerts: SecurityAlert[] = [];
  let changed = false;

  let page = previous ? stripCt(previous) : null;
  const finalUrl = result.finalUrl || target.url;
  if (input.conclusive && result.ok && home.body !== null) {
    const step = nextSecurity(page, {
      at,
      finalUrl,
      headers: result.detail?.headers ?? null,
      body: home.body,
      visible: visibleText(home.body),
      tls: result.detail?.tls
        ? {
            issuer: result.detail.tls.issuer,
            fingerprint: result.detail.tls.fingerprint,
            validTo: result.detail.tls.validTo,
          }
        : null,
    });
    page = step.state;
    changed = true;
    const origin = safeOrigin(finalUrl);
    for (const finding of step.findings) {
      alerts.push({
        severity: finding.severity,
        summary: describeSecurityFinding(target, finding),
        key: `${origin} ${finding.kind} ${finding.subject}`,
        data: { finding: finding.kind, subject: finding.subject, detail: finding.detail },
      });
    }
  }

  let ct = previous?.ct ?? null;
  let host: string | null = null;
  try {
    host = new URL(finalUrl).hostname;
  } catch {
    host = null;
  }
  if (host) {
    const { domain, pattern } = ctQuery(host);
    if (ctDue(ct, domain, Date.parse(at))) {
      changed = true;
      try {
        const step = nextCt(ct, domain, await input.ctLookup(pattern), at);
        ct = step.state;
        for (const finding of step.findings) {
          alerts.push({
            severity: finding.severity,
            summary: describeCtFinding(domain, finding),
            key: `ct ${finding.kind} ${finding.certId} ${finding.subject}`,
            data: { finding: finding.kind, subject: finding.subject, certId: finding.certId },
          });
        }
      } catch (err) {
        ct = failedCt(ct, domain, at, (err as Error)?.message ?? String(err));
      }
    }
  }

  if (!changed) return { security: undefined, alerts };
  return { security: { ...(page ?? EMPTY_SECURITY), ct }, alerts };
}

function stripCt(security: TargetSecurity) {
  const { ct: _ct, ...rest } = security;
  return rest;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
