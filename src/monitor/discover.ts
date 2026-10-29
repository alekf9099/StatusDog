/**
 * Checking a site's menu pages from its home page.
 *
 * Give StatusDog a home URL with `discover: true` and it reads the links on that
 * page, keeps the ones on the same site, and checks each of them alongside the home
 * page on every run.
 *
 * Doing that naively produces something worse than not doing it: **false green**.
 * Many sites serve the same empty application shell for every path and draw the
 * real page in the browser with JavaScript. StatusDog does not run JavaScript, so a
 * shell looks like a healthy 200 — even for a path that does not exist. On
 * copykiller.com the upload page and a made-up path are byte-for-byte identical.
 * Reporting those as up would say "checked and fine" about pages nothing checked.
 *
 * So every run also requests a path that cannot exist, and anything that answers
 * with that same shell is reported as **unverifiable** rather than up. The one
 * exception is the failure this was built to catch: a page that has served real
 * content before and now serves only the shell is not unverifiable, it is broken —
 * the blank-page outage that every status-code check misses.
 *
 * Everything here is pure. The scheduler supplies fetched bodies and stores the
 * resulting page list inside the parent target's own entry, so checking ten menu
 * pages costs no more key-value commands than checking none.
 */

import type { FailureReason } from '../config/types.js';

/** Default and ceiling for how many menu pages one site may contribute. */
export const DEFAULT_DISCOVER_LIMIT = 10;
export const MAX_DISCOVER_LIMIT = 20;

/**
 * How long a page that used to serve real content may serve only the shell before
 * it is treated as a page that is now drawn in the browser by design.
 *
 * Without this, a deliberate redesign that moved one page to client-side rendering
 * would leave it "down" forever with no way to clear it.
 */
export const SHELL_RECLASSIFY_MS = 24 * 3_600_000;

/** Files rather than pages: following these says nothing about the site's menus. */
const FILE_EXTENSIONS = /\.(?:css|js|mjs|map|json|xml|txt|ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|mp3)$/i;

/** Requesting these is pointless at best and has side effects at worst. */
const SKIP_PATHS = /\/(?:log-?out|sign-?out)(?:\/|$)/i;

/** Link text that names an action rather than a page, so it is no name at all. */
const GENERIC_LABELS = /^(?:바로가기|더보기|자세히(?: 보기)?|more|read more|learn more|see more|go|click here|here|link)$/i;

/** Screen-reader-only text, such as "(opens in a new window)". */
const SCREEN_READER_ONLY = /<(\w+)\b[^>]*class\s*=\s*["'][^"']*\b(?:sr-only|visually-hidden|blind)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;

export interface DiscoveredLink {
  /** Path only — the key a page is remembered by across runs. */
  path: string;
  /** Absolute URL to request. */
  url: string;
  /** The link's own text, for display. `null` when the link is an image or icon. */
  name: string | null;
}

/** Text a person would read, with markup, scripts and styles removed. */
export function visibleText(html: string | null | undefined): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same-site links on a page, in the order they appear.
 *
 * Only links on exactly the same origin are kept: a different scheme or host is a
 * different site, and following it would turn one configured target into requests
 * against hosts nobody configured.
 */
export function extractLinks(
  html: string | null | undefined,
  baseUrl: string,
  limit = DEFAULT_DISCOVER_LIMIT,
): DiscoveredLink[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const cap = Math.max(0, Math.min(MAX_DISCOVER_LIMIT, Math.floor(limit)));
  const seen = new Map<string, DiscoveredLink>();
  const anchor = /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of String(html ?? '').matchAll(anchor)) {
    const href = (match[3] ?? '').trim();
    if (href === '' || href.startsWith('#')) continue;
    if (/^(?:javascript|mailto|tel|data|sms):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    const path = url.pathname || '/';
    if (path === base.pathname || (path === '/' && base.pathname === '')) continue;
    if (FILE_EXTENSIONS.test(path) || SKIP_PATHS.test(path)) continue;

    const text = linkName(match[5]);
    const existing = seen.get(path);
    if (existing) {
      // The first link to a page is often an icon; a later one usually has words.
      if (!existing.name && text) existing.name = text;
      continue;
    }
    if (seen.size >= cap) continue;
    seen.set(path, { path, url: `${url.origin}${path}`, name: text });
  }

  return [...seen.values()];
}

/** What a link says it leads to, or `null` for an icon or a bare "more". */
export function linkName(inner: string | null | undefined): string | null {
  const text = visibleText(String(inner ?? '').replace(SCREEN_READER_ONLY, ' ')).slice(0, 40).trim();
  return text === '' || GENERIC_LABELS.test(text) ? null : text;
}

/**
 * A path that cannot exist on the site, for learning what its shell looks like.
 *
 * Random per run so a cache in front of the site cannot answer it from memory.
 */
export function shellProbePath(random = Math.random): string {
  return `/__statusdog-no-such-page-${Math.floor(random() * 1e12).toString(36)}`;
}

/**
 * Is this body the same page the site serves for a path that does not exist?
 *
 * Compared on visible text rather than bytes, because a shell can embed a per-
 * request nonce or build id in a script tag; the sizes must still be close, so two
 * different pages that both happen to have no visible text are not confused unless
 * they are also the same size.
 */
export function looksLikeShell(body: string | null, shellBody: string | null): boolean {
  if (body === null || shellBody === null) return false;
  if (visibleText(body) !== visibleText(shellBody)) return false;
  const a = Buffer.byteLength(body);
  const b = Buffer.byteLength(shellBody);
  if (a === 0 || b === 0) return a === b;
  return Math.max(a, b) / Math.min(a, b) <= 1.1;
}

/* ---------------- per-page state ---------------- */

export type PageState = 'up' | 'down' | 'unverifiable' | 'unknown';

/** What is stored for each menu page, inside the parent target's entry. */
export interface PageStatus {
  path: string;
  name: string | null;
  state: PageState;
  /** When `state` last changed. */
  since: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /**
   * Whether this page has ever served real content. A page that has, and now
   * serves only the shell, is failing; a page that never has is unverifiable.
   */
  verified: boolean;
  /** When an unbroken run of shell responses began, for {@link SHELL_RECLASSIFY_MS}. */
  shellSince: string | null;
  status: number | null;
  ms: number | null;
  reason: FailureReason | 'shell' | null;
  message: string | null;
  checkedAt: string | null;
}

export interface PageObservation {
  /** `shell` means the body matched the site's response for a path that cannot exist. */
  kind: 'ok' | 'failed' | 'shell';
  status: number | null;
  ms: number | null;
  reason: FailureReason | null;
  message: string | null;
  checkedAt: string;
}

/** `unverifiable` is the one-off notice that a page stopped serving checkable content. */
export type PageEvent = 'down' | 'up' | 'unverifiable' | null;

export function blankPage(link: Pick<DiscoveredLink, 'path' | 'name'>): PageStatus {
  return {
    path: link.path,
    name: link.name,
    state: 'unknown',
    since: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    verified: false,
    shellSince: null,
    status: null,
    ms: null,
    reason: null,
    message: null,
    checkedAt: null,
  };
}

export interface PageThresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

/**
 * Advance one page's state by one observation.
 *
 * The same threshold rules as a target: a page is down only after
 * `failureThreshold` failures in a row and up after `recoveryThreshold` successes,
 * so a single slow response does not page anyone.
 */
export function nextPage(
  previous: PageStatus,
  observation: PageObservation,
  thresholds: PageThresholds,
): { page: PageStatus; event: PageEvent } {
  const at = observation.checkedAt;
  const base: PageStatus = {
    ...previous,
    status: observation.status,
    ms: observation.ms,
    checkedAt: at,
  };

  if (observation.kind === 'shell') {
    if (!previous.verified) {
      // Never served real content: drawn in the browser, nothing to check here.
      const recovered = previous.state === 'down';
      return {
        page: {
          ...base,
          state: 'unverifiable',
          since: previous.state === 'unverifiable' ? previous.since : at,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          shellSince: previous.shellSince ?? at,
          reason: null,
          message: null,
        },
        event: recovered ? 'up' : null,
      };
    }

    const shellSince = previous.shellSince ?? at;
    if (Date.parse(at) - Date.parse(shellSince) >= SHELL_RECLASSIFY_MS) {
      // A day of nothing but the shell: this page is now drawn in the browser by
      // design, not broken. Stop calling it down, and say so once.
      return {
        page: {
          ...base,
          state: 'unverifiable',
          since: at,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          verified: false,
          shellSince,
          reason: null,
          message: null,
        },
        event: previous.state === 'down' ? 'unverifiable' : null,
      };
    }

    // Served real content before, serves only the empty shell now: the blank-page
    // failure that a status code alone never shows.
    return fail(
      { ...base, shellSince },
      previous,
      'shell',
      'Served the empty app shell instead of the page',
      thresholds,
    );
  }

  if (observation.kind === 'failed') {
    return fail(
      { ...base, shellSince: null },
      previous,
      observation.reason,
      observation.message,
      thresholds,
    );
  }

  // Real content, and healthy.
  const successes = previous.consecutiveSuccesses + 1;
  const comesUp = previous.state !== 'up' && successes >= thresholds.recoveryThreshold;
  return {
    page: {
      ...base,
      state: comesUp ? 'up' : previous.state === 'unverifiable' ? 'unknown' : previous.state,
      since: comesUp ? at : previous.since,
      consecutiveFailures: 0,
      consecutiveSuccesses: successes,
      verified: true,
      shellSince: null,
      reason: null,
      message: null,
    },
    event: comesUp && previous.state === 'down' ? 'up' : null,
  };
}

function fail(
  base: PageStatus,
  previous: PageStatus,
  reason: FailureReason | 'shell' | null,
  message: string | null,
  thresholds: PageThresholds,
): { page: PageStatus; event: PageEvent } {
  const failures = previous.consecutiveFailures + 1;
  const goesDown = previous.state !== 'down' && failures >= thresholds.failureThreshold;
  return {
    page: {
      ...base,
      state: goesDown ? 'down' : previous.state === 'unverifiable' ? 'unknown' : previous.state,
      since: goesDown ? base.checkedAt : previous.since,
      consecutiveFailures: failures,
      consecutiveSuccesses: 0,
      reason,
      message,
    },
    event: goesDown ? 'down' : null,
  };
}

/**
 * Carry the remembered pages forward onto this run's links.
 *
 * Pages still linked keep their history; new links start fresh; pages no longer
 * linked from the home page are dropped, because a menu entry that is gone is not
 * a page anyone is expected to reach.
 */
export function alignPages(previous: PageStatus[], links: DiscoveredLink[]): PageStatus[] {
  const byPath = new Map((previous ?? []).map((page) => [page.path, page]));
  return links.map((link) => {
    const known = byPath.get(link.path);
    if (!known) return blankPage(link);
    return { ...known, name: link.name ?? known.name };
  });
}

/** One line for a dashboard: how many pages are in each state. */
export function summarizePages(pages: PageStatus[] | null | undefined): Record<PageState, number> {
  const counts: Record<PageState, number> = { up: 0, down: 0, unverifiable: 0, unknown: 0 };
  for (const page of pages ?? []) counts[page.state] = (counts[page.state] ?? 0) + 1;
  return counts;
}
