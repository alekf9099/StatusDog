import type { Incident } from '../store/rollup.js';
import type { IncidentReport } from '../store/incident.js';

/**
 * Outage history as an RSS feed.
 *
 * This is the only way to subscribe to a StatusDog site today. Email needs an
 * address to send to and therefore an account, and there are no accounts; a feed
 * needs nothing but a URL. So the thing that would normally be the afterthought is
 * the whole subscription story, which is why the items carry the detail rather than
 * just a headline.
 *
 * RSS 2.0 rather than Atom because every reader handles it and the format is small
 * enough to emit correctly by hand.
 */

export interface FeedTarget {
  id: string;
  name: string;
  url: string;
}

export interface FeedOptions {
  target: FeedTarget;
  incidents: Incident[];
  /** Detailed reports, when there are any, keyed by their confirmed-down time. */
  reports?: IncidentReport[];
  /** Where this feed is served from, e.g. `https://status-dog.vercel.app`. */
  origin: string;
  /** Fixed rather than read from the clock, so the same input gives the same feed. */
  generatedAt: string;
  language?: string;
}

const ITEM_LIMIT = 30;

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal in XML at all, and an error page excerpt is
    // the kind of place one turns up.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** `2700000` → `45m`. Kept here because the browser helper is not importable. */
export function duration(ms: number | null | undefined): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return 'under a minute';

  const minutes = Math.round(value / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** RFC 822, which is what RSS wants and `toUTCString` already produces. */
export function rfc822(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toUTCString() : new Date(0).toUTCString();
}

function titleFor(target: FeedTarget, incident: Incident): string {
  if (incident.endedAt === null) {
    return `${target.name} is down — ongoing`;
  }
  return `${target.name} was down for ${duration(incident.durationMs)}`;
}

const FIELD_LABELS: Record<string, string> = {
  peer: 'Answering address',
  server: 'Server header',
  contentType: 'Content type',
  bodySize: 'Response size',
  finalUrl: 'Final URL',
  redirects: 'Redirect hops',
  certFingerprint: 'Certificate',
  certIssuer: 'Certificate issuer',
  tlsProtocol: 'TLS version',
};

/**
 * The item body.
 *
 * Plain text lines rather than markup: feed readers strip, reflow and restyle HTML
 * unpredictably, and every line here is a short fact.
 */
function describe(incident: Incident, report: IncidentReport | undefined): string {
  const lines: string[] = [];

  lines.push(`Started: ${rfc822(incident.startedAt)}`);
  if (incident.endedAt) {
    lines.push(`Recovered: ${rfc822(incident.endedAt)}`);
    lines.push(`Duration: ${duration(incident.durationMs)}`);
  } else {
    lines.push('Still going on.');
  }
  if (incident.reason) lines.push(`Failed on: ${incident.reason}`);
  if (incident.message) lines.push(`Detail: ${incident.message}`);

  if (report) {
    if (report.firstFailureAt && report.firstFailureAt !== report.confirmedAt) {
      lines.push(
        `First failing check ${rfc822(report.firstFailureAt)} — confirmed ${duration(report.detectionMs)} later, ` +
        `after ${report.failureChecks} failing check(s).`,
      );
    }
    if (report.failure?.status !== null && report.failure?.status !== undefined) {
      lines.push(`Status when called down: ${report.failure.status}`);
    }
    if (report.failure?.bodyExcerpt) {
      lines.push(`From the page it returned: ${report.failure.bodyExcerpt}`);
    }
    if (report.alerts) {
      lines.push(`Alerts: ${report.alerts.delivered} of ${report.alerts.attempted} delivered.`);
    }

    const changed = report.changed ?? [];
    if (report.recovery && changed.length > 0) {
      lines.push('Different on recovery (observed, not a cause):');
      for (const change of changed) {
        const label = FIELD_LABELS[change.field] ?? change.field;
        lines.push(`  ${label}: ${change.from ?? 'absent'} → ${change.to ?? 'absent'}`);
      }
    } else if (report.recovery) {
      lines.push('Nothing observably changed on recovery.');
    }
  }

  return lines.join('\n');
}

export function feedXml(options: FeedOptions): string {
  const { target, origin, generatedAt } = options;
  const byId = new Map((options.reports ?? []).map((report) => [report.confirmedAt, report]));
  const page = `${origin}/status/${encodeURIComponent(target.id)}`;

  // Newest first, and bounded: a feed reader has no use for last year's tail.
  const incidents = [...options.incidents]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, ITEM_LIMIT);

  const items = incidents.map((incident) => {
    const report = byId.get(incident.startedAt);
    return `    <item>
      <title>${escapeXml(titleFor(target, incident))}</title>
      <link>${escapeXml(page)}</link>
      <guid isPermaLink="false">${escapeXml(`statusdog:${target.id}:${incident.startedAt}`)}</guid>
      <pubDate>${rfc822(incident.startedAt)}</pubDate>
      <description>${escapeXml(describe(incident, report))}</description>
    </item>`;
  }).join('\n');

  const latest = incidents[0]?.startedAt ?? generatedAt;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`StatusDog — ${target.name}`)}</title>
    <link>${escapeXml(page)}</link>
    <atom:link href="${escapeXml(`${origin}/api/feed?target=${encodeURIComponent(target.id)}`)}" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(`Outages recorded for ${target.url}.`)}</description>
    <language>${escapeXml(options.language ?? 'en')}</language>
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
    <generator>StatusDog</generator>
${items}
  </channel>
</rss>`;
}
