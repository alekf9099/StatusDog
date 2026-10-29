/**
 * The impure half of page discovery: fetching the pages a home page links to.
 *
 * The rules live in discover.ts; this only does the requests and hands the
 * results over. The prober is injected so the whole run can be tested without a
 * network.
 */

import type { ProbeResult, ResolvedTarget } from '../config/types.js';
import type { ProbeWithBody } from './probe.js';
import {
  alignPages,
  extractLinks,
  looksLikeShell,
  nextPage,
  shellProbePath,
  type PageEvent,
  type PageObservation,
  type PageStatus,
} from './discover.js';

/** A menu page gets less patience than the page that was actually configured. */
const PAGE_TIMEOUT_MS = 8_000;

/** Requests in flight against one site at a time — a monitor, not a crawler. */
const CONCURRENCY = 4;

export type Prober = (target: ResolvedTarget) => Promise<ProbeWithBody>;

/**
 * What to request for one linked page.
 *
 * The parent's site-wide expectations carry over: the accepted statuses, the
 * error text that must never appear, the headers it sends. Its page-specific ones
 * do not — the home page's expected text, redirect count, final URL and speed
 * budget describe the home page, and would fail every other page for being a
 * different page.
 */
export function pageTarget(parent: ResolvedTarget, url: string): ResolvedTarget {
  return {
    ...parent,
    url,
    method: 'GET',
    body: null,
    timeoutMs: Math.min(parent.timeoutMs, PAGE_TIMEOUT_MS),
    expectBody: null,
    expectBodyIsRegex: false,
    expectHeaders: {},
    expectRedirects: null,
    expectFinalUrl: null,
    maxResponseTimeMs: 0,
    certExpiryWarnDays: [],
    discoverLimit: 0,
  };
}

/** Start the request for a path that cannot exist, so it can overlap the home check. */
export function probeShell(
  parent: ResolvedTarget,
  prober: Prober,
  random = Math.random,
): Promise<ProbeWithBody> {
  const url = new URL(shellProbePath(random), parent.url).href;
  return prober(pageTarget(parent, url));
}

export interface PageChange {
  page: PageStatus;
  event: Exclude<PageEvent, null>;
}

export interface PagesRun {
  pages: PageStatus[];
  changes: PageChange[];
  /**
   * Why the pages were left exactly as they were, when they were. Each case is one
   * where this run cannot say anything about the pages: judging them anyway is how
   * a broken home page turns into ten page alerts.
   */
  frozen: 'home-failed' | 'inconclusive' | 'no-body' | 'no-shell' | null;
}

export interface PagesInput {
  parent: ResolvedTarget;
  home: ProbeWithBody;
  /** Whether the home check counted; a disputed one says nothing about the pages. */
  conclusive: boolean;
  shell: ProbeWithBody;
  previous: PageStatus[];
  prober: Prober;
}

export async function checkPages(input: PagesInput): Promise<PagesRun> {
  const { parent, home, shell, previous, prober } = input;
  const frozen = (reason: PagesRun['frozen']): PagesRun => ({ pages: previous, changes: [], frozen: reason });

  if (!input.conclusive) return frozen('inconclusive');
  if (!home.result.ok) return frozen('home-failed');
  if (home.body === null) return frozen('no-body');
  // Without the shell there is nothing to tell a real page from an empty one, and
  // guessing would mark every app-shell page as verified — and later as broken.
  if (shell.body === null) return frozen('no-shell');

  const links = extractLinks(home.body, home.result.finalUrl || parent.url, parent.discoverLimit);
  const pages = alignPages(previous, links);
  const thresholds = {
    failureThreshold: parent.failureThreshold,
    recoveryThreshold: parent.recoveryThreshold,
  };

  const observations = await mapLimited(links, CONCURRENCY, async (link) => {
    const { result, body } = await prober(pageTarget(parent, link.url));
    return observe(result, body, shell.body);
  });

  const changes: PageChange[] = [];
  const next = pages.map((page, index) => {
    const { page: updated, event } = nextPage(page, observations[index]!, thresholds);
    if (event) changes.push({ page: updated, event });
    return updated;
  });

  return { pages: next, changes, frozen: null };
}

export function observe(result: ProbeResult, body: string | null, shellBody: string | null): PageObservation {
  const common = {
    status: result.status,
    ms: result.responseTimeMs,
    checkedAt: result.checkedAt,
  };
  if (!result.ok) return { ...common, kind: 'failed', reason: result.reason, message: result.message };
  if (looksLikeShell(body, shellBody)) return { ...common, kind: 'shell', reason: null, message: null };
  return { ...common, kind: 'ok', reason: null, message: null };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** One line for a chat message, in the same shape as a target's own alerts. */
export function describePageChange(parent: Pick<ResolvedTarget, 'name' | 'url'>, change: PageChange): string {
  const { page, event } = change;
  const label = `${parent.name} › ${page.name ?? page.path}`;
  const where = new URL(page.path, parent.url).href;
  if (event === 'down') {
    return `Page down: ${label} (${where})${page.message ? ` — ${page.message}` : ''}`;
  }
  if (event === 'up') return `Page recovered: ${label} (${where})`;
  return `Page no longer checkable: ${label} (${where}) — it has served only the app shell for a day, so it is now treated as drawn in the browser`;
}
