/**
 * StatusDog — string catalogue.
 *
 * One flat key space per language. Flat rather than nested so a missing key is a
 * single obvious hole, and so the key-parity test can compare two sets directly.
 *
 * Values may be:
 *   - a string, with `{placeholders}` filled by `t(key, vars)`
 *   - `{ one, other }` for counted phrases, picked by `vars.count`
 *
 * Keys ending in `Html` are inserted as markup, so they may contain links. Every
 * other key is inserted as text.
 */

export const LOCALES = {
  en: {
    /* ---------- chrome ---------- */
    'nav.home': 'Home',
    'nav.dashboard': 'Dashboard',
    'nav.docs': 'Docs',
    'nav.github': 'GitHub',
    'lang.switchLabel': 'Language',
    'lang.en': 'EN',
    'lang.ko': '한국어',
    'footer.license': 'StatusDog · MIT',
    'footer.docs': 'Docs',
    'footer.home': 'Home',
    'footer.dashboard': 'Dashboard',
    'footer.previews': 'Fallback previews',
    'footer.health': 'Health',
    'footer.api': 'API',
    'footer.github': 'GitHub',

    /* ---------- shared metrics ---------- */
    'metric.status': 'Status',
    'metric.response': 'Response',
    'metric.responseTime': 'Response time',
    'metric.avgResponse': 'Avg response',
    'metric.redirects': 'Redirects',
    'metric.sslExpires': 'SSL expires',
    'metric.failure': 'Failure',
    'metric.uptime': 'Uptime',
    'metric.checked': 'Checked',
    'metric.checks': 'Checks',
    'state.up': 'up',
    'state.down': 'down',
    'state.unknown': 'unknown',
    'value.none': 'none',
    'value.days': '{n}d',
    'time.justNow': 'just now',
    'time.secondsAgo': '{n}s ago',
    'time.minutesAgo': '{n}m ago',
    'time.hoursAgo': '{n}h ago',
    'time.daysAgo': '{n}d ago',
    'time.never': 'never',
    'spark.empty': 'No checks yet',
    'error.checkFailed': 'Check failed',
    'error.requestFailed': 'Request failed ({status})',

    /* ---------- home ---------- */
    'home.pageTitle': 'StatusDog — is your site up?',
    'home.metaDescription':
      "Check any website's status, response time, redirects and SSL certificate. Then keep watching it, and serve a maintenance page when it goes down.",
    'home.h1': 'Is your site actually up?',
    'home.lede':
      'Paste a URL. StatusDog checks it from the outside — status code, response time, redirect chain and SSL certificate — and tells you what a visitor would see right now.',
    'home.urlLabel': 'URL to check',
    'home.urlPlaceholder': 'example.com',
    'home.submit': 'Check now',
    'home.submitting': 'Checking…',
    'home.noSignup': 'No sign-up. Nothing is stored on our side.',
    'home.running': 'Running the check…',
    'home.fullReport': 'Full report',
    'home.keepWatching': 'Keep watching it',
    'home.features.h2': 'What you get',
    'home.f1.h3': 'Honest up/down',
    'home.f1.p':
      'A single blip is not an outage. StatusDog only calls a target down after a configurable number of consecutive failures, so you are not paged for one dropped packet.',
    'home.f2.h3': 'The whole request',
    'home.f2.p':
      'Every redirect hop, the final destination, response headers, and how many days are left on the TLS certificate.',
    'home.f3.h3': 'A page for when it is down',
    'home.f3.pHtml':
      'Ship a real maintenance screen instead of a connection error — standalone, as middleware, or hosted here. <a href="/preview/maintenance">See an example →</a>',
    'home.watch.h2': 'Watch it continuously',
    'home.watch.ledeHtml':
      'Add a URL to your <a href="/dashboard">dashboard</a> and this browser re-checks it on an interval, tracking uptime and response time.',
    'home.watch.noticeHtml':
      '<strong>Where the history lives.</strong> Monitors you add here are stored in this browser, and checks only run while a tab is open. Targets on the server roster are checked around the clock instead — see <a href="/docs">the docs</a>.',
    'home.self.h2': 'Or run it yourself',
    'home.self.lede':
      'StatusDog is an MIT-licensed Node package with zero runtime dependencies. The same engine that powers this page runs on your own machine.',
    'home.self.noteHtml':
      '<code>start</code> runs the check loop and opens a local dashboard at <code>127.0.0.1:4321</code>.',

    /* ---------- report ---------- */
    'check.pageTitle': 'Report — StatusDog',
    'check.metaDescription':
      'Full diagnostic report for a URL: status, response time, redirect chain, TLS certificate and response headers.',
    'check.h1': 'Diagnostic report',
    'check.submit': 'Run check',
    'check.submitting': 'Checking…',
    'check.empty': 'Enter a URL above to run a check.',
    'check.running': 'Running the check…',
    'check.checkedAt': 'checked {time}',
    'check.finalUrl': 'Final URL',
    'check.keepWatching': 'Keep watching it',
    'check.chain.h2': 'Redirect chain',
    'check.tls.h2': 'TLS certificate',
    'check.tls.subject': 'Subject',
    'check.tls.issuer': 'Issuer',
    'check.tls.validFrom': 'Valid from',
    'check.tls.validTo': 'Valid to',
    'check.tls.protocol': 'Protocol',
    'check.tls.daysSuffix': '({n} days)',
    'check.tls.valid': 'valid',
    'check.tls.expiring': 'expiring soon',
    'check.tls.expired': 'expired',
    'check.headers.h2': 'Response headers',
    'check.headers.note': 'A curated subset — cookies and credentials are never reported.',
    'check.raw': 'Raw JSON',

    /* ---------- dashboard ---------- */
    'dash.pageTitle': 'Dashboard — StatusDog',
    'dash.metaDescription':
      'Uptime and response time for monitored URLs — checked on a schedule by the server, plus your own browser-local list.',
    'dash.h1': 'Dashboard',
    'dash.server.h2': 'Monitored 24/7',
    'dash.server.loading': 'loading…',
    'dash.server.ledeHtml':
      'Checked on a schedule by the server, so history keeps accruing whether or not this page is open. The roster lives in <a href="https://github.com/alekf9099/StatusDog/blob/main/monitors.json">monitors.json</a>.',
    'dash.server.loadError': 'Could not load scheduled monitors: {message}',
    'dash.server.noStorage': 'storage not configured',
    'dash.server.noStorageHtml':
      '<strong>No store connected yet.</strong> {count} target(s) on the roster, but results are not being persisted, so there is no history to show. Connect a Redis-compatible store and set <code>CRON_SECRET</code> — see <a href="/docs">the docs</a>.',
    'dash.server.emptyRoster': 'nothing on the roster',
    'dash.server.empty': 'No targets in monitors.json.',
    'dash.summary.targets': { one: '{count} target', other: '{count} targets' },
    'dash.summary.monitors': { one: '{count} monitor', other: '{count} monitors' },
    'dash.summary.allHealthy': 'all healthy',
    'dash.summary.down': '{count} down',
    'dash.summary.notChecked': '{count} not yet checked',
    'dash.since': '{state} since {time}',
    'dash.local.h2': 'Your monitors',
    'dash.local.ledeHtml':
      'Stored in this browser and checked every <span id="interval-label">60</span>s while this tab is open — closing it stops the clock.',
    'dash.local.urlLabel': 'URL to watch',
    'dash.local.urlPlaceholder': 'Add a URL to watch — example.com',
    'dash.local.add': 'Add monitor',
    'dash.refresh': 'Check all now',
    'dash.refreshing': 'Checking…',
    'dash.remove': 'Remove',
    'dash.removeLabel': 'Remove monitor',
    'dash.checkNow': 'Check now',
    'dash.empty': 'No monitors yet. Add a URL above to start watching it.',
    'dash.noticeHtml':
      '<strong>Want a URL watched around the clock?</strong> Add it to <code>monitors.json</code> and the scheduler picks it up — the roster is a committed file rather than a form, so nobody can point StatusDog at an arbitrary target on a schedule. Or run the CLI on your own machine; see <a href="/docs">the docs</a>.',

    /* ---------- docs ---------- */
    'docs.pageTitle': 'Docs — StatusDog',
    'docs.metaDescription':
      'How to use StatusDog: the check API, the CLI, configuration, fallback pages, scheduled monitoring and alerts.',
    'docs.h1': 'Docs',
    'docs.lede':
      'StatusDog is an MIT-licensed Node package with zero runtime dependencies. This site is the hosted front end; everything here also runs on your machine.',
    'docs.can.h2': 'What this site can and cannot do',
    'docs.can.status': 'Status & availability',
    'docs.can.statusV': 'Yes — status code, failure reason, what a visitor sees',
    'docs.can.time': 'Response time',
    'docs.can.timeV': 'Yes — total time including redirects',
    'docs.can.chain': 'Redirect chain',
    'docs.can.chainV': 'Yes — every hop and the final destination',
    'docs.can.ssl': 'SSL certificate',
    'docs.can.sslV': 'Yes — issuer, validity window, days remaining',
    'docs.can.body': 'Body content check',
    'docs.can.bodyV': 'Yes — require a string to be present',
    'docs.can.history': 'Uptime history',
    'docs.can.historyV':
      'Yes for roster targets, checked on a schedule and stored; your own browser list only accrues while a tab is open',
    'docs.can.traffic': 'Traffic / visitor counts',
    'docs.can.trafficV':
      "No — that needs access to the site's own analytics or server logs, not an external probe",
    'spark.disputed': 'unclear \u2014 the two vantage points disagreed',
    'dash.disputed':
      'Checked {time}, but the two vantage points disagreed \u2014 nothing was concluded from it, so the state above is the last check that counted.',
    'office.report.disputed': 'Unclear check',
    'office.report.disputedV': '{time} \u2014 the two vantage points disagreed, so it was not counted',
    'docs.vantage.h2': 'Two vantage points',
    'docs.vantage.p1':
      'One observer cannot tell "the site is down" from "the path to the site is down". Roster checks run from Seoul; a second look comes from GitHub\u2019s network before every scheduled run, so the two can be compared.',
    'docs.vantage.p2':
      'This is not hypothetical. A site that answers in 200ms from Seoul once took 30 seconds from a US region, and StatusDog reported an outage that was not happening.',
    'docs.vantage.bothOk': 'Both saw it working',
    'docs.vantage.bothOkV': 'Counted as up.',
    'docs.vantage.bothBad': 'Both saw it failing',
    'docs.vantage.bothBadV': 'Counted as down \u2014 an outage two networks agree on.',
    'docs.vantage.split': 'Only the Seoul check failed',
    'docs.vantage.splitV':
      'Inconclusive. Recorded and visible, but kept out of the up/down decision and out of the statistics, and no alert is sent.',
    'docs.vantage.reverse': 'Only the second look failed',
    'docs.vantage.reverseV':
      'Counted as up \u2014 Seoul serves this dashboard. Still recorded: it is the early warning for a routing problem elsewhere.',
    'docs.vantage.limit':
      'Only failures the network could have caused are ever set aside \u2014 a timeout, a refused connection, DNS, a handshake, or latency over the limit. A wrong status code, forbidden text in the body, a missing header or a changed redirect chain is the site\u2019s own answer, identical from anywhere, and always counts.',
    'docs.vantage.guard':
      'Three disagreements in a row and the second look stops being believed, until the two agree again. A broken runner delays an alert by three checks and no more.',
    'docs.api.h2': 'Check API',
    'docs.api.p': 'One request, one probe. Nothing is stored.',
    'docs.api.url': 'required · http(s); a bare host gets https:// prepended',
    'docs.api.expect': 'default 2xx,3xx',
    'docs.api.contains': 'response body must contain this text',
    'docs.api.forbid': 'comma-separated text that must NOT appear — a half-broken page answers 200 with the bad news in the body',
    'docs.api.method': 'default GET',
    'docs.api.timeout': 'milliseconds, 1000–30000 · default 15000',
    'docs.api.redirects': 'false to stop following redirects',
    'docs.api.note': 'Private, loopback and link-local addresses are rejected.',
    'docs.cli.h2': 'Running it yourself',
    'docs.cli.p':
      'This browser stops checking when you close the tab. To watch a site from a machine you control, run StatusDog there.',
    'docs.cli.after':
      'start runs the check loop, persists history to data/history.json, and serves a local dashboard on 127.0.0.1:4321.',
    'docs.cli.start': 'Run the check loop and the local dashboard',
    'docs.cli.status': 'Check every target once; exits non-zero if any failed',
    'docs.cli.check': 'One-off check, no config file needed',
    'docs.cli.list': 'List configured targets',
    'docs.cli.fallback': 'Serve a maintenance page on its own port',
    'docs.cli.init': 'Write a starter config file',
    'docs.cli.note':
      'status and check exit non-zero on failure, so they drop straight into CI or a cron job.',
    'docs.assert.h2': 'Assertions beyond "it answered 200"',
    'docs.assert.pHtml':
      'A 200 is not the same as a working site. Three checks run on data the probe already collects, so they cost nothing per check.',
    'docs.assert.forbidHtml':
      '<code>forbidBody</code> — text that must <strong>not</strong> appear, one pattern or several, matched case-insensitively. This catches the half-broken page: a proxy erroring, a stack trace rendered into the template, or a maintenance notice nobody removed all answer 200 with the bad news in the body. Set <code>forbidBodyIsRegex</code> for patterns.',
    'docs.assert.headersHtml':
      '<code>expectHeaders</code> — <code>true</code> requires a header to be present, a string requires its value to contain that text. A security header dropped in a config change is invisible to every other check, so this is where HSTS and CSP get held to account.',
    'docs.assert.redirectHtml':
      '<code>expectRedirects</code> pins the exact hop count and <code>expectFinalUrl</code> pins where the chain ends, compared ignoring a trailing slash and a default port. Together they catch an interstitial appearing, an https upgrade being lost, or a redirect quietly retargeted.',
    'docs.assert.orderHtml':
      'They are judged in order of how fundamental they are — status, then where the request ended up, then headers, then body, and latency last. So a 404 with a missing header reports the 404, which is the part worth acting on.',
    'docs.config.h2': 'Configuration',
    'docs.config.p':
      'statusdog.config.json is discovered from the working directory upwards. // and /* */ comments are allowed.',
    'docs.config.afterHtml':
      'A target flips to <strong>down</strong> only after <code>failureThreshold</code> consecutive failures, so one dropped request does not trigger an alert. Full option tables are in the <a href="https://github.com/alekf9099/StatusDog#configuration">README</a>.',
    'docs.fallback.h2': 'Fallback pages',
    'docs.fallback.p':
      'When a service is down, serve a real maintenance screen instead of a connection error. Three built-in templates, plus your own HTML:',
    'docs.fallback.standalone': 'Standalone, on its own port:',
    'docs.fallback.middleware': 'Or inside your own app, gated on a monitored dependency:',
    'docs.fallback.noteHtml':
      'Requests pass through while the target is up. Once it is confirmed down, everything except <code>allowPaths</code> gets the maintenance page.',
    'docs.sched.h2': 'Scheduled monitoring, hosted',
    'docs.sched.pHtml':
      "The <a href=\"/dashboard\">dashboard</a>'s <strong>Monitored 24/7</strong> section is checked by the server and stored, so history accrues with nothing open. Two pieces make that work.",
    'docs.sched.roster.h3': 'The roster',
    'docs.sched.roster.pHtml':
      'What gets watched lives in <a href="https://github.com/alekf9099/StatusDog/blob/main/monitors.json">monitors.json</a>, a committed file using the same schema as <code>statusdog.config.json</code>. It is a file rather than a form on purpose: this site has no accounts, so a public write endpoint would let anyone point StatusDog at a URL of their choosing every 15 minutes. Editing the repo is reviewable; a form is not.',
    'docs.sched.scheduler.h3': 'The scheduler',
    'docs.sched.scheduler.pHtml':
      '<code>POST /api/cron/check</code> probes every roster target and writes the results. It needs a secret, and something has to call it:',
    'docs.sched.env.cronHtml':
      'Shared secret. Sent as <code>Authorization: Bearer …</code> or <code>x-cron-secret</code>. Unset means the route is closed, not open.',
    'docs.sched.env.kvHtml':
      'A Redis-compatible REST store. <code>UPSTASH_REDIS_REST_*</code> and <code>REDIS_REST_*</code> also work.',
    'docs.sched.env.webhook': 'Optional. One or more alert webhooks, comma-separated.',
    'docs.sched.env.on': 'Optional. down, up, or down,up (default: both).',
    'docs.sched.env.format': 'Optional. full or text; a per-host default applies otherwise.',
    'docs.sched.env.stale': 'Optional. Overrides the staleness threshold. Left unset, it is three times the cadence this deployment actually runs at.',
    'docs.sched.actionsHtml':
      "GitHub Actions does the waking up, every 15 minutes, from <code>.github/workflows/monitor.yml</code>. Vercel's Hobby plan caps cron jobs at once a day, which is useless for uptime monitoring; on a Pro plan you can add a <code>crons</code> entry to <code>vercel.json</code> instead and drop the workflow. GitHub delays scheduled runs under load, so treat 15 minutes as a floor rather than a guarantee.",
    'docs.sched.regionHtml':
      '<strong>Where the check runs matters.</strong> Latency to the target is part of every measurement, so the function region is pinned in <code>vercel.json</code> and the roster thresholds assume it. Moving the region invalidates them.',
    'docs.sched.degradeHtml':
      'Until a store is connected, <code>/api/monitors</code> reports <code>storage: "none"</code> and the dashboard says so — the rest of the site keeps working.',
    'docs.sched.read.h3': 'Read the results',
    'docs.sched.read.noteHtml':
      "Returns each roster target's state, <code>since</code>, last result, uptime and response-time stats, and recent checks. Public and read-only.",
    'docs.stats.h2': 'Statistics and the status page',
    'docs.stats.pHtml':
      'The <a href="/status">status page</a> reports uptime and response time over 24 hours, 7 days, 30 days and 90 days, with a bar per day and a list of past incidents. Each site also has its own shareable page at <code>/status/&lt;id&gt;</code>.',
    'docs.stats.rollupHtml':
      'Raw checks are capped at 480 per target — about five days at a fifteen-minute cadence — which is fine for a sparkline and useless for "how did last month go". So each check is also folded into a <strong>daily bucket</strong>: counts, failures, downtime and a latency histogram. Thirteen months of those is a few kilobytes.',
    'docs.stats.percentileHtml':
      'Percentiles come from that histogram rather than stored samples, which makes them <strong>mergeable</strong>: a weekly p95 is the sum of seven days of counters. They are accurate to a bucket, and the buckets are deliberately fine below one second because that is where most monitored sites live.',
    'docs.stats.honestHtml':
      'A window with no data reports <code>no data</code> rather than <code>0%</code> — those are different things — and every summary carries <code>daysWithData</code>, so a 100% figure drawn from two days is not mistaken for a full month. Downtime only counts intervals that were actually observed, capped per interval, so restarting a paused scheduler cannot invent an outage nobody measured.',
    'docs.stats.tzHtml':
      'A day boundary follows <code>stats.timezoneOffsetMinutes</code> in <code>monitors.json</code> — set to <code>540</code> here, so "the 19th" means the 19th in Seoul rather than in UTC. The offset is stored with the buckets, so changing it later cannot silently relabel history.',
    'docs.stats.apiHtml':
      '<code>GET /api/stats?target=&lt;id&gt;&amp;days=90</code> returns the same data as JSON: per-period summaries, daily buckets and incidents. Public and read-only.',
    'docs.alerts.h2': 'Alerts',
    'docs.alerts.pHtml':
      'Set <code>STATUSDOG_WEBHOOK_URL</code> and every confirmed up/down change posts JSON to it. <strong>Confirmed</strong> is the important word: a transition only happens after <code>failureThreshold</code> consecutive failures, and only the change fires — a target that stays down for a day alerts once, not ninety-six times.',
    'docs.alerts.payload.h3': 'Payload',
    'docs.alerts.payload.pHtml':
      'Two shapes, picked per host. <code>full</code> is the default and carries the whole event, including both <code>text</code> (what Slack renders) and <code>content</code> (what Discord renders), so either works with no adapter:',
    'docs.alerts.textHtml':
      '<code>text</code> sends only the summary — <code>{"text": "Down: …"}</code> — which strict chat APIs require.',
    'docs.alerts.gchat.h3': 'Google Chat',
    'docs.alerts.gchat.pHtml':
      'Google Chat validates the body against its Message resource and answers <code>400 Unknown name "event"</code> on any field it does not recognise, so a rich body fails outright instead of posting a degraded message. <code>chat.googleapis.com</code> therefore defaults to <code>text</code> and needs no extra configuration.',
    'docs.alerts.gchat.stepsHtml':
      'To get the URL: in the space, <strong>space name → Apps &amp; integrations → Webhooks → Add webhooks</strong>, name it, copy the URL. The <code>?key=…&amp;token=…</code> query string is the credential and is preserved on delivery.',
    'docs.alerts.delivery.h3': 'Delivery',
    'docs.alerts.delivery.pHtml':
      "Happens after results are persisted and never fails the run: an unreachable webhook is reported in the response and as a warning on the workflow run, not as a lost check. Only the webhook's origin is ever logged, because the path and query string are the credential.",
    'docs.alerts.cliHtml':
      'Running the CLI instead? Put notifiers in <code>statusdog.config.json</code> under <code>notifiers</code> — <code>console</code> and <code>webhook</code> are built in.',
    'docs.roadmap.h2': 'Roadmap',
    'docs.roadmap.p':
      'Retention is the last 480 checks per target — about five days at a 15-minute interval. Longer history, per-target alert routing, and a public status page per monitor are the obvious next steps.',

    /* ---------- office ---------- */
    'nav.office': 'Office',
    'dash.officeView': 'See the office',
    'docs.office.h2': 'The office view',
    'docs.office.pHtml':
      '<a href="/office">/office</a> shows one dog per monitored site. It is the same data as the dashboard, read as behaviour rather than as a table — which turns out to be the faster way to spot the one desk that is wrong.',
    'docs.office.hire.h3': 'Hiring a dog',
    'docs.office.hire.pHtml':
      'The form at the top of the office adds a site and gives it a dog. The look is <strong>rolled once and stored</strong> — not derived from the URL — so a dog you recognise today is the same one tomorrow, and two sites cannot end up sharing a face by coincidence. Leave the name blank and one is picked for you.',
    'docs.office.rename.h3': 'Naming and re-rolling',
    'docs.office.rename.pHtml':
      'Open a dog\'s report to rename it, roll a different one, or let an intern go. Saving a blank name restores the rolled one. <strong>These are saved in your browser only</strong> — the site has no accounts, so a server-side rename would let any visitor rename dogs for everyone. Roster dogs can be renamed but not removed here; that means editing <code>monitors.json</code>.',
    'docs.office.moods.h3': 'What each mood means',
    'docs.office.strainHtml':
      '<strong>Straining is the mood the table cannot show you.</strong> It fires when the last check is more than twice this target\'s own median — and at least 150ms above it — or when it is past 70% of the <code>maxResponseTimeMs</code> its config sets. A site that normally answers in 96ms and suddenly takes 400ms is in trouble; one that always takes 3s is not, and its dog stays calm.',
    'docs.office.staffHtml':
      'Dogs on the roster are permanent staff. Monitors you added in this browser show up as <strong>interns</strong>, because they only work while the tab is open — the badge is there so you never mistake a browser-only monitor for round-the-clock coverage.',
    'docs.office.clickHtml':
      'Click any desk for that site\'s report: status, response time against its usual, TLS expiry, response headers, and the recent history as a sparkline. Keyboard works too — desks are buttons, and <kbd>Esc</kbd> closes the panel.',
    'docs.office.mood.workingV': 'Up, and answering at its usual speed.',
    'docs.office.mood.strainedV': 'Up, but much slower than usual or close to its configured limit.',
    'docs.office.mood.uneasyV': 'A check failed, but not enough times in a row to count as an outage.',
    'docs.office.mood.alarmedV': 'Confirmed down. The wall siren comes on too.',
    'docs.office.mood.offDutyV': 'No check has run yet, so there is nothing to report.',
    'home.office.h2': 'Meet the office',
    'home.office.ledeHtml':
      'Every monitored site gets a dog colleague who watches it. They drink coffee when things are calm, sweat when the site slows down, and leap out of their chair when it goes down. <a href="/office">Visit the office →</a>',
    'office.pageTitle': 'The Office — StatusDog',
    'office.metaDescription':
      'A room of dog colleagues, one per monitored site. Each one shows how its site is doing; click a desk for the report.',
    'office.h1': 'StatusDog Office',
    'office.lede':
      'One dog per monitored site. How they behave is how their site is doing — click a desk for the full report.',
    'office.tableView': 'View as a table',
    'office.intern': 'intern',
    'office.emptyHtml':
      'Nobody has clocked in yet. Add a site on the <a href="/">home page</a> or to <code>monitors.json</code>, and a dog will take the desk.',
    'office.empty': 'Nobody has clocked in yet.',
    'office.desk.label': '{dog}, watching {site}. Status: {status}. Open the report.',

    'office.mood.working.short': 'On it 🐾',
    'office.mood.working.line': '{dog} is watching the monitor with a coffee. Nothing to report.',
    'office.mood.strained.short': 'Server is panting',
    'office.mood.strained.line':
      '{dog} is typing fast and sweating a bit — the site is answering, but much slower than it usually does.',
    'office.mood.uneasy.short': 'Something twitched',
    'office.mood.uneasy.line':
      '{dog} looked up from the screen. A check failed, but not enough times in a row to call it an outage yet.',
    'office.mood.alarmed.short': 'Down! 🚨',
    'office.mood.alarmed.line': '{dog} is out of the chair. The site is confirmed down.',
    'office.mood.offDuty.short': 'Not started',
    'office.mood.offDuty.line': '{dog} has just arrived and has not run a check yet.',

    'office.board.headcount': { one: '{count} dog on duty', other: '{count} dogs on duty' },
    'office.board.allCalm': 'a quiet day',
    'office.board.alarmed': { one: '{count} raising the alarm', other: '{count} raising the alarm' },
    'office.board.uneasy': { one: '{count} looking uneasy', other: '{count} looking uneasy' },
    'office.board.strained': { one: '{count} straining', other: '{count} straining' },
    'office.board.offDuty': { one: '{count} not started', other: '{count} not started' },
    'office.board.emptyTitle': 'Empty office.',
    'office.board.emptyHint': 'Add a site and someone will come in.',
    'office.board.offline': 'Cannot reach the roster:',
    'office.board.noStorageHtml':
      '<strong>The permanent staff are not clocked in.</strong> No store is connected, so roster results are not being kept — see <a href="/docs">the docs</a>.',

    'nav.status': 'Status',
    'duration.none': 'none',
    'duration.underMinute': 'under a minute',
    'duration.minutes': '{n}m',
    'duration.hours': '{n}h',
    'duration.hoursMinutes': '{h}h {m}m',
    'duration.days': '{n}d',
    'duration.daysHours': '{d}d {h}h',
    'status.pageTitle': 'Status — StatusDog',
    'status.metaDescription':
      'Uptime, response times and past incidents for every monitored site.',
    'status.h1': 'Service status',
    'status.lede': 'Uptime over the last 30 days. Pick a site for the full history.',
    'status.empty': 'No sites are on the roster yet.',
    'status.noStorageHtml':
      '<strong>No statistics yet.</strong> Connect a store and the scheduler will start keeping daily figures — see <a href="/docs">the docs</a>.',
    'status.allTargets': 'All sites',
    'status.periods': 'Uptime and response time',
    'status.period.day': 'Last 24 hours',
    'status.period.week': 'Last 7 days',
    'status.period.month': 'Last 30 days',
    'status.period.quarter': 'Last 90 days',
    'status.p50': 'Median',
    'status.p95': '95th pct',
    'status.downtime': 'Downtime',
    'status.incidentCount': 'Incidents',
    'status.checks': 'checks',
    'status.noData': 'no data',
    'status.daily': 'Day by day',
    'status.dailyNote': 'One bar per day, coloured by that day\'s uptime. Days start at midnight {tz}.',
    'status.incidents': 'Past incidents',
    'status.noIncidents': 'No incidents recorded.',
    'status.startedAt': 'Started',
    'status.duration': 'Lasted',
    'status.detail': 'Detail',
    'status.ongoing': 'ongoing',
    'stale.bannerHtml':
      '<strong>Nothing is being checked right now.</strong> The last check was {ago}, and this deployment normally checks every {interval} minutes. Everything below is history, not the current state.',
    'stale.bannerNever':
      'No check has run yet. Numbers will appear once the scheduler has been set up.',
    'office.hire.urlLabel': 'Website to watch',
    'office.hire.urlPlaceholder': 'example.com',
    'office.hire.nameLabel': "Dog's name (optional)",
    'office.hire.namePlaceholder': 'leave blank to roll one',
    'office.hire.submit': 'Add dog',
    'office.hire.hiring': 'Hiring…',
    'office.hire.note':
      'A dog is picked at random and keeps that look. Added dogs are interns — they only work while this tab is open, and they live in this browser.',
    'office.hire.invalid': 'That does not look like a public website address.',
    'office.hire.duplicate': 'A dog is already watching that site.',
    'office.rename.edit': 'Rename',
    'office.rename.label': "Dog's name",
    'office.rename.save': 'Save',
    'office.rename.cancel': 'Cancel',
    'office.rename.hint': 'Leave it blank to go back to the rolled name. Saved in this browser only.',
    'office.reroll': 'Roll a different dog',
    'office.dismiss': 'Remove this dog',
    'office.staffNote':
      'This one is on the server roster, so it cannot be removed here — edit monitors.json. Renaming works, and is saved in this browser.',
    'office.report.title': "{dog}'s report on {site}",
    'office.report.heading': "{dog}'s desk",
    'office.report.close': 'Close the report',
    'office.report.now': 'Right now',
    'office.report.diagnosis': 'Why this mood',
    'office.report.baseline': 'Usual response',
    'office.report.ratio': 'Versus usual',
    'office.report.limit': 'Configured limit',
    'office.report.consecutiveFailures': 'Failures in a row',
    'office.report.since': 'State since',
    'office.report.lastError': 'Last error',
    'office.report.recent': { one: 'Last {count} check', other: 'Last {count} checks' },
    'office.report.liveHeading': 'Fresh check',
    'office.report.recheck': 'Check again now',
    'office.report.checking': 'Checking…',
  },

  ko: {
    /* ---------- chrome ---------- */
    'nav.home': '홈',
    'nav.dashboard': '대시보드',
    'nav.docs': '문서',
    'nav.github': 'GitHub',
    'lang.switchLabel': '언어',
    'lang.en': 'EN',
    'lang.ko': '한국어',
    'footer.license': 'StatusDog · MIT',
    'footer.docs': '문서',
    'footer.home': '홈',
    'footer.dashboard': '대시보드',
    'footer.previews': '장애 화면 미리보기',
    'footer.health': '상태 확인',
    'footer.api': 'API',
    'footer.github': 'GitHub',

    /* ---------- shared metrics ---------- */
    'metric.status': '상태 코드',
    'metric.response': '응답 시간',
    'metric.responseTime': '응답 시간',
    'metric.avgResponse': '평균 응답',
    'metric.redirects': '리다이렉트',
    'metric.sslExpires': 'SSL 만료',
    'metric.failure': '실패 원인',
    'metric.uptime': '가동률',
    'metric.checked': '확인 시점',
    'metric.checks': '확인 횟수',
    'state.up': '정상',
    'state.down': '장애',
    'state.unknown': '미확인',
    'value.none': '없음',
    'value.days': '{n}일',
    'time.justNow': '방금',
    'time.secondsAgo': '{n}초 전',
    'time.minutesAgo': '{n}분 전',
    'time.hoursAgo': '{n}시간 전',
    'time.daysAgo': '{n}일 전',
    'time.never': '없음',
    'spark.empty': '아직 확인 기록이 없습니다',
    'error.checkFailed': '확인 실패',
    'error.requestFailed': '요청 실패 ({status})',

    /* ---------- home ---------- */
    'home.pageTitle': 'StatusDog — 사이트가 살아 있나요?',
    'home.metaDescription':
      '웹사이트의 상태 코드, 응답 시간, 리다이렉트, SSL 인증서를 확인하세요. 계속 감시하고, 장애 시 점검 화면을 대신 띄울 수 있습니다.',
    'home.h1': '사이트가 정말 살아 있나요?',
    'home.lede':
      'URL만 넣으세요. StatusDog가 외부에서 접속해 상태 코드, 응답 시간, 리다이렉트 경로, SSL 인증서를 확인하고, 지금 방문자가 무엇을 보게 되는지 알려줍니다.',
    'home.urlLabel': '확인할 URL',
    'home.urlPlaceholder': 'example.com',
    'home.submit': '지금 확인',
    'home.submitting': '확인 중…',
    'home.noSignup': '가입이 필요 없고, 입력한 내용은 저장되지 않습니다.',
    'home.running': '확인하고 있습니다…',
    'home.fullReport': '전체 리포트',
    'home.keepWatching': '계속 감시하기',
    'home.features.h2': '무엇을 알 수 있나',
    'home.f1.h3': '한 번 튄 걸로 장애라고 하지 않습니다',
    'home.f1.p':
      '한 번의 실패는 장애가 아닙니다. StatusDog는 설정한 횟수만큼 연속으로 실패해야 장애로 판정하므로, 패킷 하나 떨어진 일로 호출되지 않습니다.',
    'home.f2.h3': '요청 전체를 봅니다',
    'home.f2.p':
      '리다이렉트 각 단계와 최종 도착지, 응답 헤더, 그리고 TLS 인증서가 며칠 남았는지까지 보여줍니다.',
    'home.f3.h3': '장애일 때 보여줄 화면',
    'home.f3.pHtml':
      '연결 오류 대신 제대로 만든 점검 화면을 띄우세요. 단독 서버로, 미들웨어로, 또는 여기에 호스팅해서 쓸 수 있습니다. <a href="/preview/maintenance">예시 보기 →</a>',
    'home.watch.h2': '계속 지켜보기',
    'home.watch.ledeHtml':
      '<a href="/dashboard">대시보드</a>에 URL을 추가하면 이 브라우저가 일정 간격으로 다시 확인하며 가동률과 응답 시간을 기록합니다.',
    'home.watch.noticeHtml':
      '<strong>기록이 어디에 남는지.</strong> 여기서 추가한 모니터는 이 브라우저에 저장되고, 탭이 열려 있는 동안에만 확인이 실행됩니다. 서버 감시 목록에 등록된 대상은 24시간 내내 확인됩니다 — <a href="/docs">문서</a>를 참고하세요.',
    'home.self.h2': '직접 돌려도 됩니다',
    'home.self.lede':
      'StatusDog는 런타임 의존성이 하나도 없는 MIT 라이선스 Node 패키지입니다. 이 페이지를 움직이는 것과 같은 엔진이 여러분의 컴퓨터에서도 그대로 돕니다.',
    'home.self.noteHtml':
      '<code>start</code>는 확인 루프를 실행하고 <code>127.0.0.1:4321</code>에 로컬 대시보드를 띄웁니다.',

    /* ---------- report ---------- */
    'check.pageTitle': '진단 리포트 — StatusDog',
    'check.metaDescription':
      'URL 진단 리포트: 상태 코드, 응답 시간, 리다이렉트 경로, TLS 인증서, 응답 헤더.',
    'check.h1': '진단 리포트',
    'check.submit': '검사 실행',
    'check.submitting': '확인 중…',
    'check.empty': '위에 URL을 입력하면 검사를 시작합니다.',
    'check.running': '확인하고 있습니다…',
    'check.checkedAt': '{time} 확인',
    'check.finalUrl': '최종 URL',
    'check.keepWatching': '계속 감시하기',
    'check.chain.h2': '리다이렉트 경로',
    'check.tls.h2': 'TLS 인증서',
    'check.tls.subject': '발급 대상',
    'check.tls.issuer': '발급 기관',
    'check.tls.validFrom': '유효 시작',
    'check.tls.validTo': '유효 만료',
    'check.tls.protocol': '프로토콜',
    'check.tls.daysSuffix': '({n}일 남음)',
    'check.tls.valid': '유효',
    'check.tls.expiring': '만료 임박',
    'check.tls.expired': '만료됨',
    'check.headers.h2': '응답 헤더',
    'check.headers.note': '선별한 일부만 표시합니다 — 쿠키와 인증 정보는 절대 포함하지 않습니다.',
    'check.raw': '원본 JSON',

    /* ---------- dashboard ---------- */
    'dash.pageTitle': '대시보드 — StatusDog',
    'dash.metaDescription':
      '감시 중인 URL의 가동률과 응답 시간 — 서버가 일정에 따라 확인한 결과와, 브라우저에 저장된 내 목록.',
    'dash.h1': '대시보드',
    'dash.server.h2': '24시간 감시 중',
    'dash.server.loading': '불러오는 중…',
    'dash.server.ledeHtml':
      '서버가 일정에 따라 확인하므로, 이 페이지를 열어두지 않아도 기록이 계속 쌓입니다. 감시 목록은 <a href="https://github.com/alekf9099/StatusDog/blob/main/monitors.json">monitors.json</a>에 있습니다.',
    'dash.server.loadError': '예약 감시 목록을 불러올 수 없습니다: {message}',
    'dash.server.noStorage': '저장소 미설정',
    'dash.server.noStorageHtml':
      '<strong>저장소가 아직 연결되지 않았습니다.</strong> 감시 목록에 {count}개 대상이 있지만 결과가 저장되지 않아 표시할 기록이 없습니다. Redis 호환 저장소를 연결하고 <code>CRON_SECRET</code>을 설정하세요 — <a href="/docs">문서</a>를 참고하세요.',
    'dash.server.emptyRoster': '감시 목록이 비어 있음',
    'dash.server.empty': 'monitors.json에 등록된 대상이 없습니다.',
    'dash.summary.targets': '대상 {count}개',
    'dash.summary.monitors': '모니터 {count}개',
    'dash.summary.allHealthy': '전부 정상',
    'dash.summary.down': '{count}개 장애',
    'dash.summary.notChecked': '{count}개 미확인',
    'dash.since': '{time}부터 {state}',
    'dash.local.h2': '내 모니터',
    'dash.local.ledeHtml':
      '이 브라우저에 저장되며, 탭이 열려 있는 동안 <span id="interval-label">60</span>초마다 확인합니다 — 탭을 닫으면 멈춥니다.',
    'dash.local.urlLabel': '감시할 URL',
    'dash.local.urlPlaceholder': '감시할 URL 추가 — example.com',
    'dash.local.add': '모니터 추가',
    'dash.refresh': '전체 지금 확인',
    'dash.refreshing': '확인 중…',
    'dash.remove': '삭제',
    'dash.removeLabel': '모니터 삭제',
    'dash.checkNow': '지금 확인',
    'dash.empty': '아직 모니터가 없습니다. 위에 URL을 추가해 감시를 시작하세요.',
    'dash.noticeHtml':
      '<strong>24시간 감시가 필요하신가요?</strong> <code>monitors.json</code>에 추가하면 스케줄러가 가져갑니다. 감시 목록은 입력 폼이 아니라 커밋된 파일이라, 아무나 StatusDog를 임의의 대상에 붙일 수 없습니다. 아니면 직접 CLI를 돌리셔도 됩니다 — <a href="/docs">문서</a>를 참고하세요.',

    /* ---------- docs ---------- */
    'docs.pageTitle': '문서 — StatusDog',
    'docs.metaDescription':
      'StatusDog 사용법: 확인 API, CLI, 설정, 장애 화면, 예약 감시, 알림.',
    'docs.h1': '문서',
    'docs.lede':
      'StatusDog는 런타임 의존성이 없는 MIT 라이선스 Node 패키지입니다. 이 사이트는 호스팅된 프런트엔드이고, 여기 있는 기능은 모두 여러분의 컴퓨터에서도 동작합니다.',
    'docs.can.h2': '이 사이트로 알 수 있는 것과 알 수 없는 것',
    'docs.can.status': '상태 · 가용성',
    'docs.can.statusV': '가능 — 상태 코드, 실패 원인, 방문자가 보게 되는 화면',
    'docs.can.time': '응답 시간',
    'docs.can.timeV': '가능 — 리다이렉트를 포함한 전체 소요 시간',
    'docs.can.chain': '리다이렉트 경로',
    'docs.can.chainV': '가능 — 각 단계와 최종 도착지',
    'docs.can.ssl': 'SSL 인증서',
    'docs.can.sslV': '가능 — 발급 기관, 유효 기간, 남은 일수',
    'docs.can.body': '본문 내용 검사',
    'docs.can.bodyV': '가능 — 특정 문자열이 있는지 확인',
    'docs.can.history': '가동률 이력',
    'docs.can.historyV':
      '감시 목록 대상은 가능 — 일정에 따라 확인하고 저장합니다. 브라우저에 추가한 목록은 탭이 열려 있는 동안만 쌓입니다',
    'docs.can.traffic': '트래픽 · 방문자 수',
    'docs.can.trafficV':
      '불가능 — 외부에서 찔러보는 방식으로는 알 수 없고, 해당 사이트의 애널리틱스나 서버 로그에 접근해야 합니다',
    'spark.disputed': '판단 보류 — 두 지점의 결과가 엇갈렸습니다',
    'dash.disputed':
      '{time} 확인했지만 두 지점의 결과가 엇갈려 판단을 보류했습니다. 위 상태는 집계에 반영된 마지막 확인 결과입니다.',
    'office.report.disputed': '판단 보류된 확인',
    'office.report.disputedV': '{time} \u2014 두 지점의 결과가 엇갈려 집계하지 않았습니다',
    'docs.vantage.h2': '두 지점에서 확인',
    'docs.vantage.p1':
      '한 곳에서만 보면 "사이트가 죽었다"와 "그 사이트로 가는 길이 죽었다"를 구분할 수 없습니다. 감시 목록 확인은 서울에서 실행되고, 예정된 확인마다 그 직전에 GitHub 쪽 네트워크에서 한 번 더 봅니다. 그래서 두 결과를 맞대볼 수 있습니다.',
    'docs.vantage.p2':
      '가정이 아닙니다. 서울에서 200ms에 응답하는 사이트가 미국 리전에서는 30초가 걸린 적이 있고, StatusDog는 일어나지도 않은 장애를 알렸습니다.',
    'docs.vantage.bothOk': '양쪽 모두 정상',
    'docs.vantage.bothOkV': '정상으로 집계합니다.',
    'docs.vantage.bothBad': '양쪽 모두 실패',
    'docs.vantage.bothBadV': '장애로 집계합니다 \u2014 두 네트워크가 같은 결론을 낸 경우입니다.',
    'docs.vantage.split': '서울 확인만 실패',
    'docs.vantage.splitV':
      '판단 보류. 기록에는 남지만 정상·장애 판정과 통계에서 제외하고, 알림도 보내지 않습니다.',
    'docs.vantage.reverse': '두 번째 확인만 실패',
    'docs.vantage.reverseV':
      '정상으로 집계합니다 \u2014 이 대시보드를 서비스하는 곳이 서울이기 때문입니다. 그래도 기록은 남깁니다. 다른 경로에 문제가 생겼다는 조기 신호입니다.',
    'docs.vantage.limit':
      '네트워크 때문일 수 있는 실패만 보류합니다 \u2014 타임아웃, 연결 거부, DNS, 핸드셰이크, 응답 시간 초과. 상태 코드가 틀렸거나 본문에 금지 문자열이 있거나 헤더가 빠졌거나 리다이렉트가 바뀐 경우는 사이트가 직접 내놓은 답이고 어디서 봐도 같으므로, 언제나 그대로 집계합니다.',
    'docs.vantage.guard':
      '세 번 연속 엇갈리면 두 번째 확인을 더 이상 믿지 않고, 양쪽이 다시 일치할 때까지 그 상태를 유지합니다. 실행기가 고장 나도 알림이 확인 세 번만큼 늦어질 뿐입니다.',
    'docs.api.h2': '확인 API',
    'docs.api.p': '요청 한 번에 확인 한 번. 아무것도 저장하지 않습니다.',
    'docs.api.url': '필수 · http(s). 호스트만 넣으면 https://가 붙습니다',
    'docs.api.expect': '기본값 2xx,3xx',
    'docs.api.contains': '응답 본문에 이 문자열이 있어야 합니다',
    'docs.api.forbid': '쉼표로 구분한 금지 문자열 — 반쯤 망가진 페이지는 200을 반환하면서 본문에 오류를 담습니다',
    'docs.api.method': '기본값 GET',
    'docs.api.timeout': '밀리초, 1000–30000 · 기본값 15000',
    'docs.api.redirects': 'false로 두면 리다이렉트를 따라가지 않습니다',
    'docs.api.note': '사설 · 루프백 · 링크로컬 주소는 거부합니다.',
    'docs.cli.h2': '직접 실행하기',
    'docs.cli.p':
      '브라우저는 탭을 닫으면 확인을 멈춥니다. 직접 관리하는 서버에서 감시하려면 그곳에서 StatusDog를 실행하세요.',
    'docs.cli.after':
      'start는 확인 루프를 실행하고 이력을 data/history.json에 저장하며, 127.0.0.1:4321에 로컬 대시보드를 띄웁니다.',
    'docs.cli.start': '확인 루프와 로컬 대시보드를 실행합니다',
    'docs.cli.status': '모든 대상을 한 번씩 확인하고, 하나라도 실패하면 0이 아닌 코드로 종료합니다',
    'docs.cli.check': '설정 파일 없이 한 번만 확인합니다',
    'docs.cli.list': '설정된 대상 목록을 출력합니다',
    'docs.cli.fallback': '점검 화면을 별도 포트로 제공합니다',
    'docs.cli.init': '기본 설정 파일을 생성합니다',
    'docs.cli.note':
      'status와 check는 실패 시 0이 아닌 코드로 종료하므로 CI나 cron에 그대로 넣을 수 있습니다.',
    'docs.assert.h2': '"200이면 정상"을 넘어서',
    'docs.assert.pHtml':
      '200이 곧 정상 동작은 아닙니다. 세 가지 검증이 이미 수집 중인 데이터로 동작하므로 확인당 추가 비용이 없습니다.',
    'docs.assert.forbidHtml':
      '<code>forbidBody</code> — 나타나면 <strong>안 되는</strong> 문자열. 하나 또는 여러 개, 대소문자 구분 없이 비교합니다. 반쯤 망가진 페이지를 잡습니다: 프록시 오류, 템플릿에 렌더된 스택 트레이스, 아무도 안 지운 점검 공지 모두 200을 반환하면서 본문에 오류를 담습니다. 정규식을 쓰려면 <code>forbidBodyIsRegex</code>.',
    'docs.assert.headersHtml':
      '<code>expectHeaders</code> — <code>true</code>는 헤더 존재를 요구하고, 문자열은 값에 그 문자열이 포함되기를 요구합니다. 설정 변경으로 사라진 보안 헤더는 다른 어떤 검사에도 안 걸리므로, HSTS와 CSP를 여기서 붙잡습니다.',
    'docs.assert.redirectHtml':
      '<code>expectRedirects</code>는 정확한 홉 수를, <code>expectFinalUrl</code>은 도착지를 고정합니다(끝 슬래시와 기본 포트는 무시하고 비교). 둘이 함께 중간 페이지 삽입, https 승격 소실, 리다이렉트 대상 변경을 잡습니다.',
    'docs.assert.orderHtml':
      '판정은 근본적인 것부터 순서대로 합니다 — 상태 코드, 도착지, 헤더, 본문, 마지막에 응답 시간. 그래서 헤더가 없는 404는 404로 보고됩니다. 그게 조치해야 할 부분이니까요.',
    'docs.config.h2': '설정',
    'docs.config.p':
      'statusdog.config.json은 작업 디렉터리에서 위로 올라가며 탐색합니다. // 와 /* */ 주석을 쓸 수 있습니다.',
    'docs.config.afterHtml':
      '대상은 <code>failureThreshold</code>만큼 연속 실패해야 <strong>장애</strong>로 바뀌므로, 요청 하나 실패한 것으로 알림이 가지 않습니다. 전체 옵션표는 <a href="https://github.com/alekf9099/StatusDog#configuration">README</a>에 있습니다.',
    'docs.fallback.h2': '장애 화면',
    'docs.fallback.p':
      '서비스가 죽었을 때 연결 오류 대신 제대로 만든 점검 화면을 보여주세요. 내장 템플릿 3종과 직접 만든 HTML을 쓸 수 있습니다:',
    'docs.fallback.standalone': '별도 포트로 단독 실행:',
    'docs.fallback.middleware': '또는 감시 중인 의존성에 연동해 앱 안에서:',
    'docs.fallback.noteHtml':
      '대상이 정상인 동안 요청은 그대로 통과합니다. 장애로 확정되면 <code>allowPaths</code>를 제외한 모든 경로가 점검 화면을 받습니다.',
    'docs.sched.h2': '예약 감시 (호스팅)',
    'docs.sched.pHtml':
      '<a href="/dashboard">대시보드</a>의 <strong>24시간 감시 중</strong> 섹션은 서버가 확인하고 저장하므로, 아무것도 열어두지 않아도 기록이 쌓입니다. 두 가지가 이를 가능하게 합니다.',
    'docs.sched.roster.h3': '감시 목록',
    'docs.sched.roster.pHtml':
      '무엇을 감시할지는 <a href="https://github.com/alekf9099/StatusDog/blob/main/monitors.json">monitors.json</a>에 있고, <code>statusdog.config.json</code>과 같은 형식을 씁니다. 입력 폼이 아니라 파일인 것은 의도적입니다. 이 사이트에는 계정이 없으므로, 공개 쓰기 엔드포인트를 두면 누구나 원하는 URL을 15분마다 두들기게 시킬 수 있습니다. 저장소를 수정하는 일은 리뷰가 되지만 폼은 그렇지 않습니다.',
    'docs.sched.scheduler.h3': '스케줄러',
    'docs.sched.scheduler.pHtml':
      '<code>POST /api/cron/check</code>가 감시 목록의 모든 대상을 확인하고 결과를 기록합니다. 시크릿이 필요하고, 누군가 호출해줘야 합니다:',
    'docs.sched.env.cronHtml':
      '공유 시크릿. <code>Authorization: Bearer …</code> 또는 <code>x-cron-secret</code>으로 전달합니다. 설정하지 않으면 경로가 열리는 게 아니라 닫힙니다.',
    'docs.sched.env.kvHtml':
      'Redis 호환 REST 저장소. <code>UPSTASH_REDIS_REST_*</code>와 <code>REDIS_REST_*</code>도 인식합니다.',
    'docs.sched.env.webhook': '선택. 알림 웹훅 주소, 쉼표로 여러 개.',
    'docs.sched.env.on': '선택. down, up, 또는 down,up (기본값: 둘 다).',
    'docs.sched.env.format': '선택. full 또는 text. 지정하지 않으면 호스트별 기본값이 적용됩니다.',
    'docs.sched.env.stale': '선택. 정지 판정 임계값을 직접 지정합니다. 비워두면 이 배포가 실제로 도는 주기의 3배가 쓰입니다.',
    'docs.sched.actionsHtml':
      '깨우는 일은 GitHub Actions가 15분마다 <code>.github/workflows/monitor.yml</code>로 합니다. Vercel Hobby 플랜은 cron이 하루 1회 제한이라 가동률 감시에 쓸 수 없습니다. Pro 플랜이라면 <code>vercel.json</code>에 <code>crons</code>를 추가하고 워크플로를 지워도 됩니다. GitHub은 부하가 있을 때 예약 실행을 늦추므로, 15분은 보장이 아니라 최소 간격으로 보시면 됩니다.',
    'docs.sched.regionHtml':
      '<strong>어디서 확인하는지가 중요합니다.</strong> 대상까지의 네트워크 지연이 측정값에 그대로 포함되므로, 함수 리전을 <code>vercel.json</code>에 고정해두었고 감시 목록의 임계값은 그 리전을 기준으로 잡혀 있습니다. 리전을 옮기면 임계값이 무의미해집니다.',
    'docs.sched.degradeHtml':
      '저장소를 연결하기 전까지 <code>/api/monitors</code>는 <code>storage: "none"</code>을 반환하고 대시보드도 그렇게 표시합니다 — 사이트의 나머지 기능은 그대로 동작합니다.',
    'docs.sched.read.h3': '결과 조회',
    'docs.sched.read.noteHtml':
      '감시 목록 각 대상의 상태, <code>since</code>, 마지막 결과, 가동률과 응답 시간 통계, 최근 확인 기록을 반환합니다. 공개 읽기 전용입니다.',
    'docs.stats.h2': '통계와 상태 페이지',
    'docs.stats.pHtml':
      '<a href="/status">상태 페이지</a>는 24시간·7일·30일·90일 가동률과 응답 시간을 보여주고, 하루당 막대 하나와 과거 장애 목록을 함께 표시합니다. 사이트별로 <code>/status/&lt;id&gt;</code> 주소가 있어 공유할 수 있습니다.',
    'docs.stats.rollupHtml':
      '원본 확인 기록은 대상별 480회로 제한되며, 15분 간격 기준 약 5일입니다. 스파크라인에는 충분하지만 "지난달은 어땠나"에는 쓸 수 없습니다. 그래서 확인마다 <strong>일별 버킷</strong>에도 접어 넣습니다 — 횟수, 실패, 다운타임, 응답 시간 히스토그램. 13개월분이 수 킬로바이트입니다.',
    'docs.stats.percentileHtml':
      '백분위수는 저장된 샘플이 아니라 그 히스토그램에서 계산하므로 <strong>합칠 수 있습니다</strong> — 주간 p95는 7일치 카운터의 합입니다. 구간 단위로 근사되며, 감시 대상 대부분이 1초 이하에 있으므로 저구간을 의도적으로 촘촘하게 잡았습니다.',
    'docs.stats.honestHtml':
      '데이터가 없는 기간은 <code>0%</code>가 아니라 <code>데이터 없음</code>으로 표시합니다 — 둘은 다른 것입니다. 모든 요약에 <code>daysWithData</code>가 포함되어, 이틀치로 계산된 100%를 한 달치로 오해하지 않게 합니다. 다운타임은 실제로 관측된 구간만 세고 구간별 상한이 있어, 멈췄던 스케줄러를 다시 켜도 아무도 측정하지 않은 장애가 만들어지지 않습니다.',
    'docs.stats.tzHtml':
      '하루의 경계는 <code>monitors.json</code>의 <code>stats.timezoneOffsetMinutes</code>를 따릅니다. 여기서는 <code>540</code>으로 설정해서 "19일"이 UTC가 아니라 서울의 19일을 뜻합니다. 이 값은 버킷과 함께 저장되므로 나중에 바꿔도 과거 기록이 조용히 다시 라벨링되지 않습니다.',
    'docs.stats.apiHtml':
      '<code>GET /api/stats?target=&lt;id&gt;&amp;days=90</code>이 같은 데이터를 JSON으로 돌려줍니다 — 기간별 요약, 일별 버킷, 장애 목록. 공개 읽기 전용입니다.',
    'docs.alerts.h2': '알림',
    'docs.alerts.pHtml':
      '<code>STATUSDOG_WEBHOOK_URL</code>을 설정하면 확정된 상태 변화마다 JSON을 보냅니다. <strong>확정</strong>이라는 말이 중요합니다. 상태 변화는 <code>failureThreshold</code>만큼 연속 실패한 뒤에만 일어나고, 변화 시점에만 발송되므로 하루 종일 죽어 있어도 알림은 96번이 아니라 한 번입니다.',
    'docs.alerts.payload.h3': '전송 형식',
    'docs.alerts.payload.pHtml':
      '두 가지 형식이 있고 호스트에 따라 자동으로 선택됩니다. <code>full</code>이 기본값으로 이벤트 전체를 담으며, Slack이 읽는 <code>text</code>와 Discord가 읽는 <code>content</code>를 함께 넣으므로 어느 쪽이든 어댑터 없이 동작합니다:',
    'docs.alerts.textHtml':
      '<code>text</code>는 요약 한 줄만 보냅니다 — <code>{"text": "Down: …"}</code> — 형식을 엄격하게 검사하는 채팅 API가 이걸 요구합니다.',
    'docs.alerts.gchat.h3': 'Google Chat',
    'docs.alerts.gchat.pHtml':
      'Google Chat은 본문을 Message 스키마로 검증해서 모르는 필드가 있으면 <code>400 Unknown name "event"</code>로 거절합니다. 그래서 풍부한 본문은 내용이 부실하게 전달되는 게 아니라 아예 실패합니다. <code>chat.googleapis.com</code>은 자동으로 <code>text</code>를 쓰므로 별도 설정이 필요 없습니다.',
    'docs.alerts.gchat.stepsHtml':
      'URL 받는 방법: 스페이스에서 <strong>스페이스 이름 → 앱 및 통합 → 웹훅 → 웹훅 추가</strong>, 이름을 넣고 URL을 복사하세요. <code>?key=…&amp;token=…</code> 쿼리스트링이 인증 정보이며 전송 시 그대로 유지됩니다.',
    'docs.alerts.delivery.h3': '전송 동작',
    'docs.alerts.delivery.pHtml':
      '결과 저장이 끝난 뒤에 실행되고 절대 확인 작업을 실패시키지 않습니다. 도달할 수 없는 웹훅은 응답과 워크플로 실행 경고로 보고되며, 확인 기록이 사라지지는 않습니다. 로그에 남는 것은 웹훅의 origin뿐입니다 — 경로와 쿼리스트링이 인증 정보이기 때문입니다.',
    'docs.alerts.cliHtml':
      'CLI로 쓰신다면 <code>statusdog.config.json</code>의 <code>notifiers</code>에 넣으세요 — <code>console</code>과 <code>webhook</code>이 내장되어 있습니다.',
    'docs.roadmap.h2': '앞으로',
    'docs.roadmap.p':
      '보관 범위는 대상별 최근 480회이며, 15분 간격 기준 약 5일입니다. 더 긴 이력, 대상별 알림 분기, 모니터별 공개 상태 페이지가 다음 단계로 자연스럽습니다.',

    /* ---------- office ---------- */
    'nav.office': '오피스',
    'dash.officeView': '오피스에서 보기',
    'docs.office.h2': '오피스 화면',
    'docs.office.pHtml':
      '<a href="/office">/office</a>는 감시 중인 사이트마다 강아지 한 마리를 보여줍니다. 대시보드와 같은 데이터를 표가 아니라 행동으로 읽는 것인데, 잘못된 책상 하나를 찾는 데는 이쪽이 더 빠릅니다.',
    'docs.office.hire.h3': '강아지 채용하기',
    'docs.office.hire.pHtml':
      '오피스 상단 입력창에서 사이트를 추가하면 강아지가 배정됩니다. 외형은 <strong>한 번 무작위로 뽑아 저장</strong>되며 URL에서 계산하지 않습니다 — 그래서 오늘 알아본 강아지가 내일도 같은 강아지이고, 서로 다른 사이트가 우연히 같은 얼굴을 갖는 일도 없습니다. 이름을 비워두면 알아서 정해집니다.',
    'docs.office.rename.h3': '이름 변경과 다시 뽑기',
    'docs.office.rename.pHtml':
      '강아지 리포트를 열면 이름을 바꾸거나, 다른 강아지로 다시 뽑거나, 인턴을 내보낼 수 있습니다. 이름을 비우고 저장하면 원래 이름으로 돌아갑니다. <strong>이 설정은 사용 중인 브라우저에만 저장됩니다</strong> — 이 사이트에는 계정이 없어서 서버에 저장하면 아무나 남의 강아지 이름을 바꿀 수 있기 때문입니다. 감시 목록 소속 강아지는 이름 변경만 되고 내보내기는 <code>monitors.json</code>을 수정해야 합니다.',
    'docs.office.moods.h3': '각 상태의 의미',
    'docs.office.strainHtml':
      '<strong>"헥헥거림"은 표로는 볼 수 없는 상태입니다.</strong> 마지막 확인이 그 대상 자신의 중앙값보다 2배 넘게 느리고 최소 150ms 이상 차이 날 때, 또는 설정된 <code>maxResponseTimeMs</code>의 70%를 넘겼을 때 나타납니다. 평소 96ms인 사이트가 갑자기 400ms가 되면 문제지만, 항상 3초인 사이트는 문제가 아니므로 그 강아지는 평온합니다.',
    'docs.office.staffHtml':
      '감시 목록에 등록된 강아지는 정규직입니다. 이 브라우저에서 추가한 모니터는 <strong>인턴</strong>으로 표시되는데, 탭이 열려 있는 동안만 일하기 때문입니다. 브라우저 전용 모니터를 24시간 감시로 착각하지 않도록 붙여둔 배지입니다.',
    'docs.office.clickHtml':
      '아무 책상이나 클릭하면 그 사이트의 리포트가 열립니다: 상태 코드, 평소 대비 응답 시간, TLS 만료, 응답 헤더, 최근 이력 스파크라인. 키보드로도 됩니다 — 책상은 버튼이고 <kbd>Esc</kbd>로 패널을 닫습니다.',
    'docs.office.mood.workingV': '정상이고, 평소 속도로 응답합니다.',
    'docs.office.mood.strainedV': '정상이지만 평소보다 훨씬 느리거나 설정된 한계에 가깝습니다.',
    'docs.office.mood.uneasyV': '확인이 실패했지만 장애로 볼 만큼 연속되지는 않았습니다.',
    'docs.office.mood.alarmedV': '장애가 확정됐습니다. 벽면 경보등도 함께 켜집니다.',
    'docs.office.mood.offDutyV': '아직 확인이 실행되지 않아 보고할 것이 없습니다.',
    'home.office.h2': '오피스 구경하기',
    'home.office.ledeHtml':
      '감시 중인 사이트마다 담당 강아지가 한 마리씩 붙습니다. 평온할 때는 커피를 마시고, 사이트가 느려지면 땀을 흘리며, 장애가 나면 의자에서 벌떡 일어납니다. <a href="/office">오피스 방문하기 →</a>',
    'office.pageTitle': '오피스 — StatusDog',
    'office.metaDescription':
      '감시 중인 사이트마다 강아지 직원이 한 명. 각자 담당 사이트의 상태를 몸으로 보여줍니다. 책상을 클릭하면 리포트가 열립니다.',
    'office.h1': 'StatusDog 오피스',
    'office.lede':
      '감시 중인 사이트마다 강아지 한 마리. 강아지의 행동이 곧 그 사이트의 상태입니다 — 책상을 클릭하면 전체 리포트가 열립니다.',
    'office.tableView': '표로 보기',
    'office.intern': '인턴',
    'office.emptyHtml':
      '아직 출근한 직원이 없습니다. <a href="/">홈</a>에서 사이트를 추가하거나 <code>monitors.json</code>에 등록하면 강아지가 자리에 앉습니다.',
    'office.empty': '아직 출근한 직원이 없습니다.',
    'office.desk.label': '{dog}, {site} 담당. 상태: {status}. 리포트 열기.',

    'office.mood.working.short': '열일 중 🐾',
    'office.mood.working.line': '{dog}(이)가 커피를 들고 모니터를 보고 있습니다. 특별한 일 없습니다.',
    'office.mood.strained.short': '서버가 헥헥거려요',
    'office.mood.strained.line':
      '{dog}(이)가 땀을 흘리며 키보드를 두드리고 있습니다. 사이트가 응답은 하는데 평소보다 훨씬 느립니다.',
    'office.mood.uneasy.short': '뭔가 이상해요',
    'office.mood.uneasy.line':
      '{dog}(이)가 화면에서 고개를 들었습니다. 확인이 한 번 실패했지만, 아직 장애로 볼 만큼 연속되지는 않았습니다.',
    'office.mood.alarmed.short': '장애 발생! 🚨',
    'office.mood.alarmed.line': '{dog}(이)가 의자에서 벌떡 일어났습니다. 사이트 장애가 확정됐습니다.',
    'office.mood.offDuty.short': '대기 중',
    'office.mood.offDuty.line': '{dog}(이)가 막 출근했고 아직 확인을 실행하지 않았습니다.',

    'office.board.headcount': '근무 중 {count}마리',
    'office.board.allCalm': '조용한 하루',
    'office.board.alarmed': '{count}마리 비상',
    'office.board.uneasy': '{count}마리 불안',
    'office.board.strained': '{count}마리 헥헥',
    'office.board.offDuty': '{count}마리 대기',
    'office.board.emptyTitle': '텅 빈 사무실.',
    'office.board.emptyHint': '사이트를 추가하면 누군가 출근합니다.',
    'office.board.offline': '감시 목록을 불러올 수 없습니다:',
    'office.board.noStorageHtml':
      '<strong>정규직 직원들이 출근하지 못했습니다.</strong> 저장소가 연결되지 않아 감시 목록 결과가 보관되지 않습니다 — <a href="/docs">문서</a>를 참고하세요.',

    'nav.status': '상태',
    'duration.none': '없음',
    'duration.underMinute': '1분 미만',
    'duration.minutes': '{n}분',
    'duration.hours': '{n}시간',
    'duration.hoursMinutes': '{h}시간 {m}분',
    'duration.days': '{n}일',
    'duration.daysHours': '{d}일 {h}시간',
    'status.pageTitle': '상태 — StatusDog',
    'status.metaDescription':
      '감시 중인 모든 사이트의 가동률, 응답 시간, 과거 장애 기록.',
    'status.h1': '서비스 상태',
    'status.lede': '최근 30일 가동률입니다. 사이트를 선택하면 전체 이력을 볼 수 있습니다.',
    'status.empty': '아직 감시 목록에 사이트가 없습니다.',
    'status.noStorageHtml':
      '<strong>아직 통계가 없습니다.</strong> 저장소를 연결하면 스케줄러가 일별 수치를 쌓기 시작합니다 — <a href="/docs">문서</a>를 참고하세요.',
    'status.allTargets': '전체 사이트',
    'status.periods': '가동률과 응답 시간',
    'status.period.day': '최근 24시간',
    'status.period.week': '최근 7일',
    'status.period.month': '최근 30일',
    'status.period.quarter': '최근 90일',
    'status.p50': '중앙값',
    'status.p95': '95 백분위',
    'status.downtime': '다운타임',
    'status.incidentCount': '장애 횟수',
    'status.checks': '확인 횟수',
    'status.noData': '데이터 없음',
    'status.daily': '일별 추이',
    'status.dailyNote': '막대 하나가 하루이고, 그날 가동률에 따라 색이 정해집니다. 하루는 {tz} 자정에 시작합니다.',
    'status.incidents': '과거 장애',
    'status.noIncidents': '기록된 장애가 없습니다.',
    'status.startedAt': '시작',
    'status.duration': '지속',
    'status.detail': '상세',
    'status.ongoing': '진행 중',
    'stale.bannerHtml':
      '<strong>지금 아무것도 확인되지 않고 있습니다.</strong> 마지막 확인이 {ago}이고, 이 배포는 보통 {interval}분마다 확인합니다. 아래 내용은 현재 상태가 아니라 과거 기록입니다.',
    'stale.bannerNever':
      '아직 확인이 실행되지 않았습니다. 스케줄러를 설정하면 숫자가 채워집니다.',
    'office.hire.urlLabel': '감시할 웹사이트',
    'office.hire.urlPlaceholder': 'example.com',
    'office.hire.nameLabel': '강아지 이름 (선택)',
    'office.hire.namePlaceholder': '비워두면 랜덤',
    'office.hire.submit': '강아지 추가',
    'office.hire.hiring': '채용 중…',
    'office.hire.note':
      '강아지는 무작위로 뽑히고 그 모습을 그대로 유지합니다. 여기서 추가한 강아지는 인턴입니다 — 이 탭이 열려 있는 동안만 일하고, 이 브라우저에만 저장됩니다.',
    'office.hire.invalid': '공개된 웹사이트 주소로 보이지 않습니다.',
    'office.hire.duplicate': '이미 그 사이트를 보고 있는 강아지가 있습니다.',
    'office.rename.edit': '이름 변경',
    'office.rename.label': '강아지 이름',
    'office.rename.save': '저장',
    'office.rename.cancel': '취소',
    'office.rename.hint': '비워두고 저장하면 원래 이름으로 돌아갑니다. 이 브라우저에만 저장됩니다.',
    'office.reroll': '다른 강아지로 바꾸기',
    'office.dismiss': '이 강아지 내보내기',
    'office.staffNote':
      '이 강아지는 서버 감시 목록 소속이라 여기서 내보낼 수 없습니다 — monitors.json을 수정하세요. 이름 변경은 가능하고, 이 브라우저에만 저장됩니다.',
    'office.report.title': '{dog}의 {site} 리포트',
    'office.report.heading': '{dog}의 책상',
    'office.report.close': '리포트 닫기',
    'office.report.now': '현재 상태',
    'office.report.diagnosis': '왜 이런 상태인가',
    'office.report.baseline': '평소 응답',
    'office.report.ratio': '평소 대비',
    'office.report.limit': '설정된 한계',
    'office.report.consecutiveFailures': '연속 실패',
    'office.report.since': '상태 유지 시작',
    'office.report.lastError': '마지막 오류',
    'office.report.recent': '최근 {count}회 확인',
    'office.report.liveHeading': '지금 다시 확인',
    'office.report.recheck': '지금 다시 확인',
    'office.report.checking': '확인 중…',
  },
};
