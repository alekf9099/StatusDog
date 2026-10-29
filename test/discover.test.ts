import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignPages,
  blankPage,
  extractLinks,
  linkName,
  looksLikeShell,
  nextPage,
  SHELL_RECLASSIFY_MS,
  shellProbePath,
  summarizePages,
  visibleText,
  type PageObservation,
  type PageStatus,
} from '../src/monitor/discover.js';
import { checkPages, describePageChange, pageTarget, type Prober } from '../src/monitor/subpages.js';
import { ConfigError, resolveConfig } from '../src/config/index.js';
import type { ProbeResult, ResolvedTarget } from '../src/config/types.js';
import type { ProbeWithBody } from '../src/monitor/probe.js';

const HOME = 'https://example.com/';
const T = { failureThreshold: 2, recoveryThreshold: 1 };

/* ---------------- finding the links ---------------- */

test('keeps same-site links in page order, as paths, with their text', () => {
  const html = `
    <a href="/docs">Docs</a>
    <a href="https://example.com/pricing?ref=nav">Pricing</a>
    <a href="blog/">Blog</a>`;
  assert.deepEqual(extractLinks(html, HOME), [
    { path: '/docs', url: 'https://example.com/docs', name: 'Docs' },
    { path: '/pricing', url: 'https://example.com/pricing', name: 'Pricing' },
    { path: '/blog/', url: 'https://example.com/blog/', name: 'Blog' },
  ]);
});

test('never leaves the site: another host, scheme or port is a different site', () => {
  const html = `
    <a href="https://other.com/a">x</a>
    <a href="https://sub.example.com/b">x</a>
    <a href="http://example.com/c">x</a>
    <a href="https://example.com:8443/d">x</a>
    <a href="//evil.test/e">x</a>`;
  assert.deepEqual(extractLinks(html, HOME), []);
});

test('skips anchors, scripts, mail, files, logout and the page itself', () => {
  const html = `
    <a href="#top">top</a>
    <a href="javascript:void(0)">js</a>
    <a href="mailto:a@example.com">mail</a>
    <a href="tel:123">call</a>
    <a href="/brochure.pdf">pdf</a>
    <a href="/logo.png">img</a>
    <a href="/logout">bye</a>
    <a href="/">home</a>
    <a href="/?lang=ko">home again</a>
    <a href="">nothing</a>`;
  assert.deepEqual(extractLinks(html, HOME), []);
});

test('the same page linked twice is one page, named by whichever link has words', () => {
  const html = `<a href="/docs"><svg></svg></a> <a href="/docs#intro">Documentation</a>`;
  assert.deepEqual(extractLinks(html, HOME), [
    { path: '/docs', url: 'https://example.com/docs', name: 'Documentation' },
  ]);
});

test('stops at the limit, and the limit cannot be raised past the ceiling', () => {
  const html = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join('');
  assert.equal(extractLinks(html, HOME, 3).length, 3);
  assert.equal(extractLinks(html, HOME, 999).length, 20);
  assert.equal(extractLinks(html, HOME).length, 10);
});

test('resolves relative links against where the home page actually ended up', () => {
  const html = `<a href="team">Team</a>`;
  assert.deepEqual(extractLinks(html, 'https://example.com/about/'), [
    { path: '/about/team', url: 'https://example.com/about/team', name: 'Team' },
  ]);
});

test('a link that says only "more", or is only an icon, has no name', () => {
  assert.equal(linkName('바로가기<span class="sr-only">(새 창 열림)</span><svg></svg>'), null);
  assert.equal(linkName('Read more'), null);
  assert.equal(linkName('<img alt="">'), null);
  assert.equal(linkName('Pricing <span class="sr-only">(opens in a new tab)</span>'), 'Pricing');
  assert.equal(linkName('문서작성 바로가기'), '문서작성 바로가기');
});

test('no body or a malformed base gives no links rather than an error', () => {
  assert.deepEqual(extractLinks(null, HOME), []);
  assert.deepEqual(extractLinks('<a href="/x">x</a>', 'not a url'), []);
});

/* ---------------- telling a page from the empty shell ---------------- */

const SHELL = `<!doctype html><html><head><script nonce="abc">window.__b="1"</script></head>
  <body><div id="root"></div><script src="/main.js"></script></body></html>`;

test('visible text ignores scripts, styles and markup', () => {
  assert.equal(visibleText('<style>p{}</style><p>Hi&nbsp;<b>there</b></p><script>x()</script>'), 'Hi there');
});

test('the shell with a different nonce is still the shell', () => {
  assert.equal(looksLikeShell(SHELL.replace('abc', 'xyz'), SHELL), true);
});

test('a page with words of its own is not the shell', () => {
  assert.equal(looksLikeShell(SHELL.replace('<div id="root"></div>', '<h1>Pricing</h1>'), SHELL), false);
});

test('two wordless pages of very different size are not confused', () => {
  const big = SHELL.replace('window.__b="1"', 'x'.repeat(10_000));
  assert.equal(looksLikeShell(big, SHELL), false);
});

test('without both bodies nothing is called a shell', () => {
  assert.equal(looksLikeShell(null, SHELL), false);
  assert.equal(looksLikeShell(SHELL, null), false);
});

test('the probe path is new every run, so a cache cannot answer it', () => {
  let n = 0;
  const random = () => (++n) / 7;
  assert.notEqual(shellProbePath(random), shellProbePath(random));
  assert.match(shellProbePath(), /^\/__statusdog-no-such-page-[a-z0-9]+$/);
});

/* ---------------- one page's state ---------------- */

let clock = Date.parse('2026-10-01T00:00:00Z');
function obs(kind: PageObservation['kind'], over: Partial<PageObservation> = {}): PageObservation {
  clock += 5 * 60_000;
  return {
    kind,
    status: kind === 'failed' ? 500 : 200,
    ms: 100,
    reason: kind === 'failed' ? 'status' : null,
    message: kind === 'failed' ? 'Expected 2xx, got 500' : null,
    checkedAt: new Date(clock).toISOString(),
    ...over,
  };
}

function run(page: PageStatus, ...observations: PageObservation[]) {
  const events = [];
  for (const observation of observations) {
    const step = nextPage(page, observation, T);
    page = step.page;
    events.push(step.event);
  }
  return { page, events };
}

const fresh = () => blankPage({ path: '/p', name: 'P' });

test('real content brings a page up and marks it as one that can be checked', () => {
  const { page, events } = run(fresh(), obs('ok'));
  assert.equal(page.state, 'up');
  assert.equal(page.verified, true);
  // Nobody is told a page they never heard was down has come up.
  assert.deepEqual(events, [null]);
});

test('a page that has only ever been the shell is unverifiable and never alerts', () => {
  const { page, events } = run(fresh(), obs('shell'), obs('shell'), obs('shell'));
  assert.equal(page.state, 'unverifiable');
  assert.equal(page.consecutiveFailures, 0);
  assert.deepEqual(events, [null, null, null]);
});

test('down only after the failure threshold, and up again on recovery', () => {
  const { page, events } = run(fresh(), obs('ok'), obs('failed'), obs('failed'), obs('failed'), obs('ok'));
  assert.deepEqual(events, [null, null, 'down', null, 'up']);
  assert.equal(page.state, 'up');
});

test('one failure is not an outage', () => {
  const { page, events } = run(fresh(), obs('ok'), obs('failed'), obs('ok'));
  assert.deepEqual(events, [null, null, null]);
  assert.equal(page.state, 'up');
});

test('a real page that turns into the empty shell is down — the blank-page outage', () => {
  const { page, events } = run(fresh(), obs('ok'), obs('shell'), obs('shell'));
  assert.deepEqual(events, [null, null, 'down']);
  assert.equal(page.reason, 'shell');
});

test('after a day of nothing but the shell, the page is accepted as browser-drawn', () => {
  let { page } = run(fresh(), obs('ok'), obs('shell'), obs('shell'));
  assert.equal(page.state, 'down');
  clock += SHELL_RECLASSIFY_MS;
  const step = nextPage(page, obs('shell'), T);
  assert.equal(step.page.state, 'unverifiable');
  assert.equal(step.event, 'unverifiable');
  assert.equal(step.page.verified, false);
  // And it is quiet from then on.
  page = step.page;
  assert.equal(nextPage(page, obs('shell'), T).event, null);
});

test('a broken link that never worked still goes down: a 404 in the menu is real', () => {
  const { events } = run(fresh(), obs('failed', { status: 404 }), obs('failed', { status: 404 }));
  assert.deepEqual(events, [null, 'down']);
});

test('pages follow the links: kept, added fresh, or dropped when no longer linked', () => {
  const up = { ...fresh(), path: '/a', state: 'up' as const, verified: true };
  const gone = { ...fresh(), path: '/gone', state: 'down' as const };
  const pages = alignPages([up, gone], [
    { path: '/a', url: 'https://example.com/a', name: 'A renamed' },
    { path: '/new', url: 'https://example.com/new', name: null },
  ]);
  assert.deepEqual(pages.map((p) => [p.path, p.state, p.name]), [
    ['/a', 'up', 'A renamed'],
    ['/new', 'unknown', null],
  ]);
});

test('summary counts each state', () => {
  const pages = [
    { ...fresh(), state: 'up' as const },
    { ...fresh(), state: 'up' as const },
    { ...fresh(), state: 'unverifiable' as const },
  ];
  assert.deepEqual(summarizePages(pages), { up: 2, down: 0, unverifiable: 1, unknown: 0 });
  assert.deepEqual(summarizePages(null), { up: 0, down: 0, unverifiable: 0, unknown: 0 });
});

/* ---------------- the run ---------------- */

const roster = resolveConfig({
  targets: [{
    id: 'site',
    name: 'Site',
    url: HOME,
    discover: true,
    expectBody: 'Welcome',
    expectRedirects: 0,
    maxResponseTimeMs: 500,
    forbidBody: ['Internal Server Error'],
  }],
});
const parent = roster.targets[0]!;

function response(url: string, body: string | null, ok = true): ProbeWithBody {
  const result: ProbeResult = {
    url,
    finalUrl: url,
    ok,
    status: ok ? 200 : 503,
    responseTimeMs: 50,
    redirects: 0,
    checkedAt: new Date(clock).toISOString(),
    reason: ok ? null : 'status',
    message: ok ? null : 'Expected 2xx, got 503',
    detail: null,
  };
  return { result, body };
}

const HOME_BODY = '<h1>Welcome</h1><a href="/docs">Docs</a><a href="/app">App</a>';

function fakeSite(pages: Record<string, () => ProbeWithBody>): { prober: Prober; asked: ResolvedTarget[] } {
  const asked: ResolvedTarget[] = [];
  const prober: Prober = async (target) => {
    asked.push(target);
    const path = new URL(target.url).pathname;
    return (pages[path] ?? (() => response(target.url, SHELL)))();
  };
  return { prober, asked };
}

test('discovery is opt-in per target, bounded, and validated', () => {
  assert.equal(parent.discoverLimit, 10);
  assert.equal(resolveConfig({ targets: [{ url: HOME }] }).targets[0]!.discoverLimit, 0);
  assert.equal(resolveConfig({ targets: [{ url: HOME, discover: true, discoverLimit: 3 }] }).targets[0]!.discoverLimit, 3);
  assert.throws(() => resolveConfig({ targets: [{ url: HOME, discover: true, discoverLimit: 50 }] }), ConfigError);
  // From `defaults` it would multiply every site's requests at once.
  assert.equal(
    resolveConfig({ defaults: { discover: true }, targets: [{ url: HOME }] }).targets[0]!.discoverLimit,
    0,
  );
});

test('a linked page keeps the site-wide rules and drops the home page\'s own', () => {
  const page = pageTarget(parent, 'https://example.com/docs');
  assert.equal(page.expectBody, null);
  assert.equal(page.expectRedirects, null);
  assert.equal(page.maxResponseTimeMs, 0);
  assert.deepEqual(page.forbidBody, ['Internal Server Error']);
  assert.deepEqual(page.expectStatus, parent.expectStatus);
  assert.equal(page.discoverLimit, 0);
});

test('checks every linked page and tells real pages from the shell', async () => {
  const { prober } = fakeSite({
    '/docs': () => response('https://example.com/docs', '<h1>Docs</h1>'),
  });
  const run1 = await checkPages({
    parent,
    home: response(HOME, HOME_BODY),
    conclusive: true,
    shell: response('https://example.com/__x', SHELL),
    previous: [],
    prober,
  });
  assert.equal(run1.frozen, null);
  assert.deepEqual(run1.pages.map((p) => [p.path, p.state]), [['/docs', 'up'], ['/app', 'unverifiable']]);
  assert.deepEqual(run1.changes, []);
});

test('a page going down is reported once, as a change', async () => {
  let docs = () => response('https://example.com/docs', '<h1>Docs</h1>');
  const { prober } = fakeSite({ '/docs': () => docs() });
  const input = {
    parent,
    home: response(HOME, HOME_BODY),
    conclusive: true,
    shell: response('https://example.com/__x', SHELL),
    prober,
  };
  let pages = (await checkPages({ ...input, previous: [] })).pages;
  docs = () => response('https://example.com/docs', 'Internal Server Error', false);
  pages = (await checkPages({ ...input, previous: pages })).pages;
  const third = await checkPages({ ...input, previous: pages });
  assert.deepEqual(third.changes.map((c) => [c.page.path, c.event]), [['/docs', 'down']]);
  assert.equal(
    describePageChange(parent, third.changes[0]!),
    'Page down: Site › Docs (https://example.com/docs) — Expected 2xx, got 503',
  );
});

test('when the home check failed or was disputed, the pages are left alone', async () => {
  const before = [{ ...blankPage({ path: '/docs', name: 'Docs' }), state: 'up' as const, verified: true }];
  const { prober, asked } = fakeSite({});
  const base = { parent, shell: response('https://example.com/__x', SHELL), previous: before, prober };

  const failed = await checkPages({ ...base, home: response(HOME, 'down', false), conclusive: true });
  assert.equal(failed.frozen, 'home-failed');
  assert.equal(failed.pages, before);

  const disputed = await checkPages({ ...base, home: response(HOME, HOME_BODY), conclusive: false });
  assert.equal(disputed.frozen, 'inconclusive');

  // No shell to compare against: guessing would mark shells as verified pages.
  const noShell = await checkPages({ ...base, home: response(HOME, HOME_BODY), conclusive: true, shell: response('x', null, false) });
  assert.equal(noShell.frozen, 'no-shell');

  // None of these asked the site for anything.
  assert.equal(asked.length, 0);
});
