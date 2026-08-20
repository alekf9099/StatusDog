import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duration, escapeXml, feedXml, rfc822, type FeedOptions } from '../src/feed/rss.js';
import type { Incident } from '../src/store/rollup.js';
import type { IncidentReport } from '../src/store/incident.js';

const TARGET = { id: 'copykiller', name: 'CopyKiller', url: 'https://www.copykiller.com/' };

function incident(over: Partial<Incident> = {}): Incident {
  return {
    startedAt: '2026-08-20T03:00:00.000Z',
    endedAt: '2026-08-20T03:45:00.000Z',
    durationMs: 45 * 60_000,
    reason: 'status',
    status: 503,
    message: 'Unexpected status 503',
    ...over,
  };
}

function feed(over: Partial<FeedOptions> = {}): string {
  return feedXml({
    target: TARGET,
    incidents: [incident()],
    origin: 'https://status-dog.vercel.app',
    generatedAt: '2026-08-20T04:00:00.000Z',
    ...over,
  });
}

/* ---------------- formatting ---------------- */

test('durations read as a person would say them', () => {
  assert.equal(duration(45 * 60_000), '45m');
  assert.equal(duration(60 * 60_000), '1h');
  assert.equal(duration(135 * 60_000), '2h 15m');
  assert.equal(duration(26 * 3_600_000), '1d 2h');
  assert.equal(duration(48 * 3_600_000), '2d');
  assert.equal(duration(20_000), 'under a minute');
  assert.equal(duration(null), 'under a minute');
  assert.equal(duration(Number.NaN), 'under a minute');
});

test('dates are RFC 822, which is what RSS requires', () => {
  assert.equal(rfc822('2026-08-20T03:00:00.000Z'), 'Thu, 20 Aug 2026 03:00:00 GMT');
});

test('an unparseable date degrades instead of emitting "Invalid Date"', () => {
  // A reader that hits an invalid pubDate may reject the whole feed.
  assert.match(rfc822('not a date'), /^Thu, 01 Jan 1970/);
});

test('control characters are stripped, because they are illegal in XML', () => {
  const dirty = `a${String.fromCharCode(0)}b${String.fromCharCode(27)}c`;
  assert.equal(escapeXml(dirty), 'abc');
  // Tabs and newlines are legal and must survive.
  assert.equal(escapeXml('a\tb\nc'), 'a\tb\nc');
});

/* ---------------- the channel ---------------- */

test('the channel names itself, its page and its own address', () => {
  const xml = feed();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<title>StatusDog — CopyKiller</title>'));
  assert.ok(xml.includes('<link>https://status-dog.vercel.app/status/copykiller</link>'));
  assert.ok(xml.includes('href="https://status-dog.vercel.app/api/feed?target=copykiller" rel="self"'));
  assert.ok(xml.includes('<language>en</language>'));
});

test('the language is declared so a reader can label it', () => {
  assert.ok(feed({ language: 'ko' }).includes('<language>ko</language>'));
});

test('lastBuildDate follows the newest incident, not the clock', () => {
  // Otherwise every poll looks like new content.
  assert.ok(feed().includes('<lastBuildDate>Thu, 20 Aug 2026 03:00:00 GMT</lastBuildDate>'));
});

test('with no incidents the feed is valid and empty rather than an error', () => {
  const xml = feed({ incidents: [] });
  assert.ok(xml.includes('<channel>'));
  assert.ok(!xml.includes('<item>'));
  assert.ok(xml.includes('<lastBuildDate>Thu, 20 Aug 2026 04:00:00 GMT</lastBuildDate>'));
});

/* ---------------- items ---------------- */

test('a finished outage says how long it lasted', () => {
  const xml = feed();
  assert.ok(xml.includes('<title>CopyKiller was down for 45m</title>'));
  assert.ok(xml.includes('Duration: 45m'));
  assert.ok(xml.includes('Failed on: status'));
});

test('an ongoing outage says so instead of claiming a duration', () => {
  const xml = feed({ incidents: [incident({ endedAt: null, durationMs: null })] });
  assert.ok(xml.includes('is down — ongoing'));
  assert.ok(xml.includes('Still going on.'));
  assert.ok(!xml.includes('Duration:'));
});

test('items are newest first whatever order they arrive in', () => {
  const xml = feed({
    incidents: [
      incident({ startedAt: '2026-08-01T00:00:00.000Z' }),
      incident({ startedAt: '2026-08-20T00:00:00.000Z' }),
      incident({ startedAt: '2026-08-10T00:00:00.000Z' }),
    ],
  });
  const dates = [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]!);
  assert.deepEqual(dates, [
    'Thu, 20 Aug 2026 00:00:00 GMT',
    'Mon, 10 Aug 2026 00:00:00 GMT',
    'Sat, 01 Aug 2026 00:00:00 GMT',
  ]);
});

test('the feed is bounded, so a year of outages does not become one document', () => {
  const many = Array.from({ length: 80 }, (_, i) =>
    incident({ startedAt: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:00:00.000Z` }));
  const xml = feed({ incidents: many });
  assert.equal([...xml.matchAll(/<item>/g)].length, 30);
});

test('a guid is stable and not mistaken for a URL', () => {
  const xml = feed();
  assert.ok(xml.includes('<guid isPermaLink="false">statusdog:copykiller:2026-08-20T03:00:00.000Z</guid>'));
});

/* ---------------- the detailed report ---------------- */

function report(over: Partial<IncidentReport> = {}): IncidentReport {
  return {
    id: '2026-08-20T03:00:00.000Z',
    targetId: 'copykiller',
    confirmedAt: '2026-08-20T03:00:00.000Z',
    firstFailureAt: '2026-08-20T02:30:00.000Z',
    failureChecks: 2,
    detectionMs: 30 * 60_000,
    firstSuccessAt: '2026-08-20T03:30:00.000Z',
    recoveredAt: '2026-08-20T03:45:00.000Z',
    durationMs: 45 * 60_000,
    failure: {
      at: '2026-08-20T03:00:00.000Z', status: 503, responseTimeMs: 8421, reason: 'status',
      message: 'Unexpected status 503', finalUrl: null, redirects: 0, peer: '104.18.32.77',
      server: 'cloudflare', contentType: 'text/html', bodySize: 512,
      bodyExcerpt: '503 Service Temporarily Unavailable', certFingerprint: null,
      certIssuer: null, certValidTo: null, tlsProtocol: 'TLSv1.3',
    },
    recovery: {
      at: '2026-08-20T03:45:00.000Z', status: 200, responseTimeMs: 197, reason: null,
      message: null, finalUrl: null, redirects: 0, peer: '13.209.144.20',
      server: 'nginx', contentType: 'text/html', bodySize: 86_540, bodyExcerpt: null,
      certFingerprint: null, certIssuer: null, certValidTo: null, tlsProtocol: 'TLSv1.3',
    },
    changed: [
      { field: 'peer', from: '104.18.32.77', to: '13.209.144.20' },
      { field: 'bodySize', from: '512', to: '86540' },
    ],
    precursor: [],
    vantage: 'confirmed-failed',
    alerts: { attempted: 2, delivered: 1, failed: 1 },
    ...over,
  };
}

test('a subscriber gets the report, not just a headline', () => {
  const xml = feed({ reports: [report()] });
  assert.ok(xml.includes('confirmed 30m later'));
  assert.ok(xml.includes('after 2 failing check(s)'));
  assert.ok(xml.includes('Status when called down: 503'));
  assert.ok(xml.includes('503 Service Temporarily Unavailable'));
  assert.ok(xml.includes('Alerts: 1 of 2 delivered.'));
});

test('the recovery diff is labelled as observed rather than as a cause', () => {
  const xml = feed({ reports: [report()] });
  assert.ok(xml.includes('Different on recovery (observed, not a cause):'));
  assert.ok(xml.includes('Answering address: 104.18.32.77 → 13.209.144.20'));
  assert.ok(xml.includes('Response size: 512 → 86540'));
});

test('no observed difference is stated plainly instead of omitted', () => {
  const xml = feed({ reports: [report({ changed: [] })] });
  assert.ok(xml.includes('Nothing observably changed on recovery.'));
});

test('a report is matched to its incident and a mismatch is simply skipped', () => {
  const xml = feed({ reports: [report({ confirmedAt: '2020-01-01T00:00:00.000Z' })] });
  assert.ok(xml.includes('<item>'));
  assert.ok(!xml.includes('Status when called down'), 'the unmatched report is not attached');
});

/* ---------------- injection ---------------- */

test('nothing from a monitored site can break out of the XML', () => {
  const xml = feed({
    target: { id: 'x', name: 'A & B <b>', url: 'https://x.example/?a=1&b=2' },
    incidents: [incident({ message: '</description><script>alert(1)</script>' })],
  });
  assert.ok(!xml.includes('<script>'));
  assert.ok(xml.includes('A &amp; B &lt;b&gt;'));
  assert.ok(xml.includes('&lt;/description&gt;'));
  assert.ok(xml.includes('a=1&amp;b=2'));
});
