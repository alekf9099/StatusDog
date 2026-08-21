# StatusDog

A lightweight monitoring and automated fallback/error screen management tool.

StatusDog pings your sites and APIs on a schedule, decides when they are really
down (not just having a bad second), and serves a proper maintenance page in the
meantime — either as standalone server or as middleware inside your own app.

- **Zero runtime dependencies.** Node's built-in `http`/`https` only.
- **Three ways to use it:** CLI, embeddable library, or a standalone fallback server.
- **Self-contained pages.** The dashboard and fallback templates are single HTML
  documents with no external requests — they still render when everything else is down.

**Live site:** <https://status-dog.vercel.app> — paste a URL and get a report on
what a visitor would see right now.

---

## Requirements

Node.js **18.17** or newer.

## Install

```bash
git clone https://github.com/alekf9099/StatusDog.git
```

```bash
cd StatusDog && npm install && npm run build
```

Then either use the local build (`node dist/cli.js …`) or link it so `statusdog`
is on your `PATH`:

```bash
npm link
```

During development you can skip the build step and run the TypeScript directly:

```bash
npm run dev -- check https://example.com
```

## Quick start

```bash
statusdog check https://example.com --expect 200
```

```bash
statusdog init && statusdog start
```

`init` writes a starter `statusdog.config.json`; `start` begins the check loop and
opens the dashboard on <http://127.0.0.1:4321>.

---

## Hosted site

<https://status-dog.vercel.app> is this repo deployed to Vercel — the same engine
behind a web front end.

| Route | What it does |
| --- | --- |
| `/` | Paste a URL, get an instant verdict |
| `/check?url=…` | Full report: status, timing, redirect chain, TLS certificate, headers |
| `/office` | The same monitors as dog colleagues, one per site |
| `/dashboard` | Watch a list of URLs, with uptime and response-time history |
| `/docs` | Usage docs |
| `/preview/:template` | Live previews of the fallback screens |
| `/api/check?url=…` | JSON API for a single check |
| `/status`, `/status/:id` | Public status page: uptime, day-by-day, past incidents |
| `/api/monitors` | The 24/7 roster with stored state and history |
| `/api/stats` | Period summaries, daily buckets and incidents |
| `/api/cron/check` | Scheduler entry point (authenticated) |
| `/healthz` | Liveness probe for the site itself |

### The office

[`/office`](https://status-dog.vercel.app/office) draws one dog per monitored site
and lets its behaviour carry the status. It reads the same data as the dashboard;
what it adds is a mood the table has no column for.

| Mood | Meaning |
| --- | --- |
| **On it** | Up, answering at its usual speed |
| **Server is panting** | Up, but far slower than usual, or past 70% of its configured `maxResponseTimeMs` |
| **Something twitched** | A check failed, but not enough times in a row to be an outage |
| **Down** | Confirmed down; the wall siren comes on |
| **Not started** | No check has run yet |

**Hiring.** The form at the top of the office adds a site and assigns it a dog.
The look is *rolled once and stored*, not derived from the URL — so a dog stays
recognisable, and two sites cannot coincidentally share a face. Open a dog's
report to rename it, roll a different one, or let an intern go; saving a blank
name restores the rolled one.

Renames and looks live in `localStorage`, which makes them **per browser**. That
is deliberate: the site has no accounts, so a server-side rename endpoint would let
any visitor rename dogs for everyone. Google login is planned, at which point
[`createDogOverrideStore`](public/assets/office/overrides.js) takes a
server-backed adapter and nothing else in the office changes.

*Straining* is the useful one. It compares the last check against **this target's
own median**, not a fixed threshold: more than 2× and at least 150ms above it. A
site that normally answers in 96ms and suddenly takes 400ms is in trouble; one
that always takes 3s is not, and its dog stays calm. Roster targets are permanent
staff; browser-local monitors are badged **interns**, because they only work while
the tab is open.

Clicking a desk opens that site's report — status, response time against its
usual, TLS expiry, headers, recent history. Desks are buttons, so the keyboard
works and <kbd>Esc</kbd> closes the panel.

| File | Role |
| --- | --- |
| [`office/mood.js`](public/assets/office/mood.js) | Mood derivation — pure, and unit-tested |
| [`office/dogs.js`](public/assets/office/dogs.js) | Who each dog is: the catalogue, the random roll, override resolution |
| [`office/overrides.js`](public/assets/office/overrides.js) | Where a rename or re-roll is remembered |
| [`office/url.js`](public/assets/office/url.js) | Tidies what someone typed into the hire form |
| [`office/DogWorkerCard.js`](public/assets/office/DogWorkerCard.js) | One desk: the inline-SVG dog, its props, its nameplate |
| [`office/ServerReportModal.js`](public/assets/office/ServerReportModal.js) | The report slide-over |
| [`office/OfficeDashboard.js`](public/assets/office/OfficeDashboard.js) | The floor: data loading, layout, click routing |

A roster dog's name, coat and accessory come from a hash of its target id, so a
target nobody has touched still has a consistent colleague; a hired dog's come
from the roll stored when it joined. Everything is inline SVG and CSS — no
images, nothing fetched — and `prefers-reduced-motion` gets a still version where
posture, colour and props still tell the states apart.

The site is available in English and Korean. It follows the browser language by
default; `?lang=en` or `?lang=ko` overrides it and makes a link shareable in that
language. Strings live in [`public/assets/locales.js`](public/assets/locales.js) —
a test asserts the two tables have identical keys and placeholders, so a missing
translation fails CI rather than showing up as English text on a Korean page.

```bash
curl "https://status-dog.vercel.app/api/check?url=example.com&expect=200"
```

`/api/check` accepts `url` (required), `expect`, `contains`, `method`, `timeout`
(1000–30000 ms) and `redirects`. Private, loopback and link-local addresses are
rejected, and only a curated set of response headers is reported — never cookies
or credentials.

The dashboard has two halves: **Monitored 24/7**, checked on a schedule by the
server and stored, and **Your monitors**, kept in your browser and checked only
while a tab is open.

**What the site cannot do.** Traffic and visitor counts are not measurable from
outside; that needs the site's own analytics or server logs.

Run the site locally with:

```bash
npm run dev:web
```

---

## Scheduled monitoring

Uptime history that accrues with nothing open needs two things: a list of what to
watch, and something to do the watching.

### The roster

[`monitors.json`](monitors.json) — same schema as `statusdog.config.json`, and
the only place the hosted site takes its 24/7 targets from.

```json
{
  "defaults": { "timeoutMs": 15000, "failureThreshold": 2, "expectStatus": ["2xx"] },
  "targets": [
    { "id": "api", "name": "Public API", "url": "https://example.com/health", "expectBody": "\"status\":\"ok\"" }
  ]
}
```

It is a committed file rather than a form on purpose. The hosted site has no
accounts, so a public write endpoint would let anyone enlist StatusDog to hit a
URL of their choosing every 15 minutes. Editing the repo is reviewable.

The roster is baked into `dist/roster.data.js` at build time by
[`scripts/generate-roster.mjs`](scripts/generate-roster.mjs) — a bundler cannot see
through `readFile(cwd + '/monitors.json')`, so reading it at runtime would leave
the file out of the deployment.

### Assertions beyond "it answered 200"

A 200 is not the same as a working site. Three checks run on data the probe
already collects, so they cost nothing per check.

```json
{
  "forbidBody": ["502 Bad Gateway", "Internal Server Error"],
  "expectHeaders": { "strict-transport-security": true, "x-frame-options": "DENY" },
  "expectRedirects": 1,
  "expectFinalUrl": "https://www.example.com/"
}
```

- **`forbidBody`** catches the half-broken page. A proxy erroring, a stack trace
  rendered into the template, or a maintenance notice nobody removed all answer
  **200 with the bad news in the body** — which nothing else here would notice.
  One pattern or several, matched case-insensitively; `forbidBodyIsRegex` for patterns.
- **`expectHeaders`** holds security headers to account. `true` requires presence,
  a string requires the value to contain it. An HSTS or CSP header dropped in a
  config change is invisible to every other check.
- **`expectRedirects`** pins the hop count and **`expectFinalUrl`** pins the
  destination, compared ignoring a trailing slash and a default port — those are not
  redirect changes, and treating them as such would make the assertion useless.
  Together they catch an interstitial appearing, an https upgrade lost, or a
  redirect quietly retargeted.

They are judged in order of how fundamental they are — status, then destination,
then headers, then body, and latency last. A 404 with a missing header reports the
404, which is the part worth acting on.

`/api/check` takes `forbid` as a comma-separated list for one-off checks.

### The scheduler

`POST /api/cron/check` probes every roster target and persists the results.

| Environment variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Shared secret, sent as `Authorization: Bearer …` or `x-cron-secret`. **Unset closes the route rather than opening it.** |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | A Redis-compatible REST store. `UPSTASH_REDIS_REST_*` and `REDIS_REST_*` are also accepted. |
| `STATUSDOG_WEBHOOK_URL` | Optional. Alert webhooks, comma-separated. |
| `STATUSDOG_WEBHOOK_ON` | Optional. `down`, `up`, or `down,up` (default: both). |
| `STATUSDOG_WEBHOOK_FORMAT` | Optional. `full` or `text`; per-host default otherwise. |
| `STATUSDOG_STALE_AFTER_MINUTES` | Optional. Overrides the staleness threshold. Left unset, it is three times the cadence this deployment actually runs at. |

[`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) calls it every 15
minutes and needs two repository secrets, `MONITOR_ENDPOINT` and `CRON_SECRET`.
GitHub Actions rather than Vercel Cron because the Hobby plan caps cron at once a
day; on Pro, add a `crons` entry to `vercel.json` and drop the workflow. Either
way, GitHub and Vercel both delay scheduled runs under load, so 15 minutes is a
floor and not a guarantee.

Nothing here is required. With no store configured, `/api/monitors` returns
`storage: "none"`, the dashboard says as much, and the rest of the site is
unaffected.

#### Incident reports

An incident used to be six fields: when it started, when it ended, how long, and a
single word like `timeout`. That says an outage happened and nothing about it.

Every confirmed change now writes a report to its own key, read through
`GET /api/incidents` and shown on each target's status page:

**Timeline** — the first failing check, when the threshold was crossed, the first
check that passed again, and the confirmed recovery. The gap between the first
failure and the confirmation is the **detection delay**: the price of
`failureThreshold`, stated rather than hidden.

**Leading up to it** — the checks before the first failure, with their response
times. A site that crept from 208ms to 1.6s before falling over failed differently
from one that died instantly, and this is the only place that difference is visible.

**What was seen** — two snapshots, one from the moment it was called down and one
from the moment it came back: status, latency, the address that answered, the
`server` header, content type, response size, TLS version, and — on the failing
side only — a 400-character excerpt of the page it returned.

**Whether anyone was told** — how many alert deliveries were attempted and how many
landed, per incident. A webhook that silently stopped working is otherwise invisible.

`/api/incidents` is public, so the excerpt is only kept for plain public GETs. A
target configured with request `headers` or a request `body` is an authenticated or
non-idempotent check, and its response is not something every visitor could see —
those keep the status code, the curated headers and the response size, and no page
content.

#### What it deliberately does not claim

StatusDog watches from *outside* the site. It cannot see a service being restarted
or a deploy rolled back, so it never says what fixed anything. What it can do is
list what is **observably different** now that it works:

```
Different on recovery
  Answering address   104.18.32.77 → 13.209.144.20
  Server header       cloudflare   → nginx
  Response size       512 B        → 85 KB
```

That is enough to see the traffic is going somewhere else and the page is no longer
a stub — which is where to look, not what happened. The UI labels it as observed
differences for that reason, and says so plainly when there are none. The cause and
the remedy are for a person to write down; there is nowhere to write them yet,
because the site has no accounts and a public write endpoint would let any visitor
edit everyone's outage history, for the same reason [the roster is a committed
file](#the-roster).

Comparison covers the fields that might explain a recovery and skips the ones that
merely restate it: status, latency and failure reason are the symptom, and "it was
failing and now it is not" is the definition of a recovery rather than a finding.
Response size is only reported when it appears, vanishes, or moves by more than a
quarter, so ordinary page jitter stays out.

#### Two vantage points

One observer cannot tell *the site is down* from *the path to the site is down*.

This is not hypothetical. copykiller.com answers in about 200ms from Seoul; from
Vercel's US-East region it once took 30 seconds, timed out, and StatusDog duly
reported an outage and sent an alert. The site was fine. What was being measured
was a transpacific round trip.

So the GitHub Actions runner takes its own look at every target before it wakes the
scheduler, and posts what it saw:

```json
{ "vantage": { "name": "github-actions",
               "checks": [ { "id": "copykiller", "reachable": true, "status": 200 } ] } }
```

The runner only *measures*. Whether a status counts as healthy is decided
server-side against each target's own `expectStatus`, so the policy lives in one
place — 301 is healthy for a target that expects a redirect and a failure for one
that does not, and the runner cannot know which.

| Both saw | Outcome |
| --- | --- |
| Working | Counted as up. |
| Failing | Counted as down. A real outage, agreed on by two networks. |
| Primary failed, runner reached it | **Inconclusive.** Stored and visible, but kept out of the state machine and the statistics, and nobody is paged. |
| Primary worked, runner could not reach it | Counted as up — the primary is the region that serves the dashboard. Recorded anyway: it is the early warning for a routing problem. |

Two limits, both deliberate:

- **Only failures the network could have caused are ever disputed** — a timeout, a
  refused connection, DNS, a handshake, or latency over `maxResponseTimeMs`. A
  wrong status code, forbidden text in the body, a missing header or a changed
  redirect chain is the site's own answer, identical from anywhere, and is never
  suppressed. Otherwise this feature would be a way of hiding real content faults.
- **Three disputes in a row and the runner stops being believed** (`dispute-exhausted`).
  A runner whose own network is broken would otherwise report every target as
  reachable and mute a genuine outage indefinitely. Exhaustion sticks until the two
  agree again, so a broken runner delays a page by three checks and no more.

A missing, empty or malformed body is simply no second opinion: the primary stands
alone and alerts exactly as it did before. The improvement can never be a
prerequisite for the check.

### Taking it with you

Four things that need no account, because there are none.

**A badge.** `GET /api/badge?target=<id>` returns one self-contained SVG — no
script, no webfont, no second request — so it renders anywhere:

```markdown
[![CopyKiller](https://status-dog.vercel.app/api/badge?target=copykiller)](https://status-dog.vercel.app/status/copykiller)
```

`metric=state` shows up/down instead of a percentage, `days` sets the uptime window
and `label` overrides the left-hand text. Thresholds match the status page, so a
badge and the page it links to never disagree. It is cached for five minutes and it
always renders: an unknown target, a missing store or a failed read all produce a
grey badge saying so, because a broken image in someone's README is worse than an
honest "no data".

**A feed.** `GET /api/feed?target=<id>` is RSS 2.0, and it is the only way to
subscribe today: email needs an address and therefore an account, a feed needs
nothing but a URL. Items carry the whole incident report — timeline, detection
delay, the failing status, the page excerpt, whether the alerts landed, and what was
observably different on recovery — so a reader is not just told that something broke.

**The browser tab.** With a StatusDog page open in a background tab, the title
becomes `(2 down) Dashboard` and the favicon takes a coloured dot. Anything
unchecked shows amber rather than green, because "we have not looked" is not "it is
fine".

**Clean-run records.** Each roster dog's desk shows how long since it last had a
bad day, and its report adds how long it has been on the job and its best run.
Computed from `since` and the incident list — no new storage. A dog with no history
says nothing rather than claiming a clean sheet it has not earned, and a dog that is
down right now has no streak at all, which is not the same as zero days.

### Alerts

Every confirmed up/down change posts JSON to each configured webhook. *Confirmed*
carries the weight: a transition only happens after `failureThreshold`
consecutive failures, and only the change fires — a target down for a day alerts
once, not ninety-six times.

#### Payload

Two shapes, picked per host.

`full` (the default) carries the whole event, and includes both `text` (what Slack
renders) and `content` (what Discord renders), so either works with no adapter:

```json
{
  "event": "down",
  "previousState": "up",
  "target": { "id": "api", "name": "Public API", "url": "https://example.com/health" },
  "result": { "ok": false, "status": 503, "responseTimeMs": 31, "reason": "status" },
  "at": "2026-08-19T07:00:00.000Z",
  "text": "Down: Public API (https://example.com/health) — Unexpected status 503",
  "content": "Down: Public API (https://example.com/health) — Unexpected status 503"
}
```

`text` sends only the summary:

```json
{ "text": "Down: Public API (https://example.com/health) — Unexpected status 503" }
```

Strict chat APIs need it. **Google Chat** validates the body against its Message
resource and answers `400 Invalid JSON payload received. Unknown name "event"` on
anything it does not recognise — a rich body there fails outright rather than
posting a degraded message. So `chat.googleapis.com` defaults to `text`; set
`STATUSDOG_WEBHOOK_FORMAT` to override either way.

#### Google Chat

In the space: **space name → Apps & integrations → Webhooks → Add webhooks**, name
it, then copy the URL. It looks like
`https://chat.googleapis.com/v1/spaces/AAA/messages?key=…&token=…` — the query
string is the credential, and it is preserved on delivery. Put it in
`STATUSDOG_WEBHOOK_URL` and redeploy; no other setting is needed.

#### Delivery

Runs after results are persisted and never fails the run — an unreachable webhook
comes back in the response and as a warning on the workflow run, not as a lost
check. Only a webhook's **origin** is ever logged or returned, since the path (or
query string) is the credential.

For the CLI, notifiers come from `statusdog.config.json` instead:

```json
"notifiers": [
  { "type": "console" },
  { "type": "webhook", "url": "https://hooks.example.com/statusdog", "on": ["down"] }
]
```

#### Certificate expiry

The probe already reads the certificate on every check, so warnings cost nothing
extra. `certExpiryWarnDays` defaults to `[1, 3, 7, 14, 30]`; each threshold fires
**once per certificate**, and renewing resets them. Set it to `[]` to turn them off.

An expiring certificate is the one total outage that is entirely foreseeable — by
the time the handshake breaks, the site is already down. Related: certificate
failures now report as `reason: "tls"` with a readable message
(`TLS certificate does not cover this hostname`) rather than an opaque
`network: ERR_TLS_CERT_ALTNAME_INVALID`.

#### When the scheduler itself stops

Everything above notices when a *site* goes quiet. Nothing noticed when the
*scheduler* did, and that is the worse failure: silence looks exactly like health,
so a revoked token or an exhausted Actions quota would leave the dashboard showing
last Tuesday's green numbers.

Three things watch for it now, with deliberately different blind spots:

| Watcher | Notices | Within |
| --- | --- | --- |
| `/api/cron/heartbeat` on **Vercel Cron**, daily | Runs have stopped | a day |
| `/api/cron/check` itself | Runs have resumed | 15 minutes |
| The office and dashboard banner | Either, when a human looks | immediately |

Vercel Cron rather than GitHub Actions for the heartbeat, because Actions is the
thing being watched. Daily is all the Hobby plan allows, and a dead scheduler found
within a day beats one never found at all.

The banner is the part that matters most in practice: a stale view says so in
plain words instead of presenting old numbers as current.

#### The threshold is measured, not assumed

The workflow asks GitHub for a run every fifteen minutes. Over 28 observed runs on
this repo GitHub actually delivered one every **32 minutes** on median, with gaps up
to 58 — scheduled workflows are best-effort, and a busy queue delays them.

A fixed 45-minute threshold therefore fired on a perfectly healthy scheduler. So the
interval is learned from the gaps this deployment actually sees (median of the last
20, ignoring gaps long enough to be outages rather than cadence), and the threshold
is three of those, floored at 30 minutes and capped at six hours.

With the real history that lands on a 30-minute cadence and a 90-minute threshold:
the 52- and 58-minute gaps that used to false-alarm stay quiet, and a genuinely
stopped scheduler still trips at 100 minutes.

## Owner sign-in

Everything the site shows is public and read-only. The only thing that needs an
identity is **writing**, so that is all this gates.

### Authentication is not authorization

Google sign-in proves who somebody is, and everyone on earth has a Google account.
`STATUSDOG_ADMIN_EMAILS` is the actual gate. Without it, nothing is authorized —
adding sign-in *without* a list would make the deployment worse than having none.

The list is re-read on every request rather than baked into the session cookie, so
removing an address revokes it on the next request instead of whenever the session
happens to expire.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | For the code exchange |
| `STATUSDOG_SESSION_SECRET` | Signs the session cookie. 32+ random bytes |
| `STATUSDOG_ADMIN_EMAILS` | Comma-separated owner addresses — **the gate** |
| `STATUSDOG_SITE_URL` | Optional but recommended: pins the origin instead of deriving it from the request |

With any of the first four missing, `adminConfigured` is false: sign-in returns 503,
the UI hides its admin affordances entirely, and `/api/admin/*` refuses everything.
**Unset closes the door rather than opening it**, exactly as `CRON_SECRET` does.

Redirect URI to register with Google:

```
https://<your-deployment>/api/auth/callback
```

One function serves every auth step and every admin action, dispatched on
`?action=` behind a rewrite. Vercel's Hobby plan allows twelve serverless
functions per deployment and this project is at twelve, so **a new admin action
goes into `api/admin.js` rather than a new file** — the pretty paths come from
`vercel.json`, so nothing about the URLs changes.

### Where the control lives

The account control sits in the site header on every page, because the first
version put it under the subscribe box on a single status page — which meant
somebody who had signed in could not find how to sign out.

`/signin` is a page in the site's own design rather than a bare link: it says what
signing in is for (everything is public and read-only; only writing needs an
account), warns that Google will call the app unverified while it is in testing,
and states plainly that being signed in grants nothing on its own. The failure
codes the callback can return are rendered there too — `denied` in particular,
because "that account is not an owner" needs a different fix from "try again".

With no admin surface configured the control renders nothing at all. A reader who
can never be an owner should not be shown a door that opens onto a 503.

### How the session works

A signed cookie, and nothing else — no session table, no store, which suits a
serverless deployment where any request may hit a cold instance.

- `HttpOnly`, `Secure`, `SameSite=Lax`, one week
- HMAC-SHA256 over the payload, compared in constant time
- **Revoking everything everywhere**: rotate `STATUSDOG_SESSION_SECRET`. Every
  existing session becomes invalid at once, which is the answer for a lost laptop
- The ID token is verified by asking Google (`tokeninfo`) rather than checking the
  signature locally. Sign-in happens once a week, so a round trip costs nothing and
  removes a family of subtle JWT-verification mistakes that all look like working code

### Writes are checked twice

`/api/admin/*` refuses a request before it looks at the session unless both hold:

- the `Origin` header is this site — a cross-site form post carries the attacker's
  origin and cannot forge this one
- a custom `x-statusdog-admin` header is present — a plain form cannot set one at
  all, and a script elsewhere would need a CORS preflight this site never approves

### Incident notes

The first thing sign-in unlocks, and the reason it exists.
[Incident reports](#incident-reports) record in detail what was observed and refuse
to guess at a cause, because a probe outside the site cannot see one. `POST
/api/admin/note` is where a person supplies it:

```json
{ "target": "copykiller", "incident": "2026-08-20T03:00:00.000Z",
  "cause": "Origin ran out of connections",
  "action": "Raised the pool size and restarted" }
```

Notes appear on the public status page, at the top of the report they belong to —
explaining an outage to whoever is reading is the point of writing one. Two details:

- **The author's address is stored and never served.** Knowing which owner wrote a
  note belongs in the record; publishing an email on a public page does not
- **Notes live in their own key**, not in the incident log. That log is written by
  the scheduler; sharing a key would mean a cron run and a saved postmortem could
  overwrite each other, and losing hand-written words that way is not acceptable in
  the way losing a bucket count is

Clearing both fields deletes the note.

### Still a file

The roster is not editable here. `monitors.json` stays a committed file for now, and
UI editing is a separate step: once the site can add monitors, it can be told to
fetch arbitrary URLs every fifteen minutes, so that write path needs the same
address guard `/api/check` has plus a target cap before it exists at all.

## Statistics

[`/status`](https://status-dog.vercel.app/status) reports uptime and response time
over **24 hours, 7 days, 30 days and 90 days**, one bar per day, and a list of past
incidents. Each site has a shareable page of its own at `/status/<id>`.

### How a month of history fits in a few kilobytes

Raw checks are capped at 480 per target — five days at a fifteen-minute cadence —
which is fine for a sparkline and useless for "how did last month go". So each
check is *also* folded into a **daily bucket**: counts, failures, downtime, and a
latency histogram. Thirteen months of those is tiny.

Percentiles come from that histogram rather than stored samples, which makes them
**mergeable**: a weekly p95 is the sum of seven days of counters, something a
stored average could never give you. They are accurate to a bucket, and the buckets
are deliberately fine below one second — with coarse ones, a site sitting between
90ms and 160ms had an identical p50 and p95, which is true and useless.

### Where it refuses to guess

- A window with no data reports **`no data`, not `0%`** — those are different things.
- Every summary carries `daysWithData`, so a 100% figure drawn from two days is not
  mistaken for a full month.
- Downtime counts **only intervals that were actually observed**, capped per
  interval, so restarting a paused scheduler cannot invent an outage nobody measured.
- A day boundary follows `stats.timezoneOffsetMinutes` in
  [`monitors.json`](monitors.json) (`540` here), so "the 19th" means the 19th in
  Seoul. The offset is stored *with* the buckets, so changing it later cannot
  silently relabel history.

```bash
curl "https://status-dog.vercel.app/api/stats?target=copykiller&days=90"
```
Storage keeps the last 480 checks per target — about five days at a 15-minute
interval — under `statusdog:v1:target:<id>`. The client is ~100 lines of `fetch`
in [`src/store/kv.ts`](src/store/kv.ts); a monitoring tool that needs a
40-package client library to record "the site was up" has its priorities
backwards.

---

## Configuration

StatusDog looks for `statusdog.config.json` (then `statusdog.json`, then
`.statusdogrc.json`) in the working directory and every parent directory, or
wherever `--config` points. `//` and `/* */` comments are allowed.

See [`statusdog.config.example.json`](statusdog.config.example.json) for a
fully annotated file. The short version:

```json
{
  "defaults": { "intervalMs": 60000, "failureThreshold": 2 },
  "targets": [
    {
      "id": "api",
      "name": "Public API",
      "url": "https://example.com/health",
      "expectStatus": [200],
      "expectBody": "\"status\":\"ok\"",
      "maxResponseTimeMs": 3000,
      "fallback": { "template": "maintenance", "title": "API unavailable" }
    }
  ],
  "dashboard": { "port": 4321 },
  "notifiers": [{ "type": "console" }]
}
```

### Target options

| Option | Default | Meaning |
| --- | --- | --- |
| `id` | slug of the URL | Stable identifier used by the CLI, API and middleware |
| `name` | `id` | Display name |
| `url` | — | `http:` or `https:` URL (required) |
| `method` | `GET` | HTTP method |
| `headers` | `{}` | Extra request headers |
| `body` | — | Request body (ignored for `GET`/`HEAD`) |
| `intervalMs` | `60000` | How often to probe |
| `timeoutMs` | `10000` | Total budget per probe, redirects included |
| `expectStatus` | `["2xx","3xx"]` | Healthy statuses: `200`, `"2xx"`, `"200-299"`, `"*"` |
| `expectBody` | — | Body must contain this text |
| `expectBodyIsRegex` | `false` | Treat `expectBody` as a regular expression |
| `maxResponseTimeMs` | `0` (off) | Fail the check when slower than this |
| `followRedirects` | `true` | Follow 3xx responses |
| `maxRedirects` | `5` | Redirect hop limit |
| `failureThreshold` | `2` | Consecutive failures before the target is marked **down** |
| `recoveryThreshold` | `1` | Consecutive successes before it is marked **up** |
| `fallback` | see below | Page served while this target is down |
| `enabled` | `true` | Set `false` to keep a target in the config but skip it |

Anything in `defaults` is inherited by every target and can be overridden per target.

### Fallback options

| Option | Default | Meaning |
| --- | --- | --- |
| `template` | `maintenance` | `maintenance`, `error`, `offline`, or a path to an HTML file |
| `title` | `We will be right back` | Page heading |
| `message` | generic apology | Body text |
| `statusCode` | `503` | Status served with the page |
| `retryAfterSeconds` | `120` | `Retry-After` header and auto-refresh interval |
| `vars` | `{}` | Extra `{{placeholders}}` for custom templates |

Template paths are resolved relative to the config file, so a config can be moved
without breaking.

### Other sections

| Section | Default | Meaning |
| --- | --- | --- |
| `storage.file` | `data/history.json` | Where check history is persisted; `null` keeps it in memory |
| `storage.historyLimit` | `500` | Records kept per target |
| `dashboard.enabled` / `.host` / `.port` | `true` / `127.0.0.1` / `4321` | Web dashboard |
| `notifiers` | `[{ "type": "console" }]` | Alerting on up/down transitions |
| `logLevel` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

A webhook notifier posts JSON on every transition:

```json
{ "type": "webhook", "url": "https://hooks.example.com/statusdog", "on": ["down", "up"] }
```

---

## CLI

```
statusdog <command> [options]
```

| Command | What it does |
| --- | --- |
| `start` | Run the check loop and the dashboard until interrupted |
| `status` | Check every target once, print a summary, exit non-zero if any failed |
| `check <url>` | One-off check of a single URL — no config file needed |
| `list` | List configured targets |
| `fallback` | Serve a fallback page on its own port |
| `init` | Write a starter config file |

Shared options: `-c, --config <path>`, `--log-level <level>`.
Run `statusdog help` for the full list.

```bash
statusdog check https://example.com --expect 2xx --contains '"status":"ok"' --json
```

```bash
statusdog fallback --port 8080 --template maintenance --title "Back at 02:00 UTC"
```

`status` and `check` exit `0` when everything passed and `1` otherwise, so they
drop straight into CI or a cron job.

## Dashboard

`statusdog start` serves a live view at <http://127.0.0.1:4321> plus a small JSON API:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status?history=N` | Every target's state, stats and recent checks |
| `GET /api/history?target=<id>&limit=N` | Full retained history for one target |
| `GET /api/preview?target=<id>` | Preview that target's fallback page |
| `POST /api/check?target=<id>` | Run checks immediately (omit `target` for all) |

The dashboard binds to `127.0.0.1` by default. It has no authentication, so put it
behind a proxy before exposing it beyond localhost.

---

## Serving fallback pages

### Standalone server

Point your load balancer at StatusDog while the real service is down:

```bash
statusdog fallback --port 8080 --target api
```

Every path answers with the fallback page (`503` by default, plus `Retry-After`);
`/healthz` stays `200` so orchestrators can tell the fallback itself is alive.

### As middleware

Serve the maintenance page from inside your own app when a dependency is down:

```ts
import express from 'express';
import { loadConfig, Monitor, createFallbackMiddleware } from 'statusdog';

const app = express();
const monitor = new Monitor(await loadConfig());
monitor.start();

app.use(
  createFallbackMiddleware(monitor, {
    targetId: 'payments-api',
    allowPaths: ['/healthz', /^\/webhooks\//],
  }),
);
```

Requests pass through untouched while the target is up. Once it is confirmed down
— after `failureThreshold` consecutive failures — everything except `allowPaths`
gets the maintenance page instead.

### Live previews

The hosted site renders each built-in template so you can see it before wiring
it up: [maintenance](https://status-dog.vercel.app/preview/maintenance) ·
[error](https://status-dog.vercel.app/preview/error) ·
[offline](https://status-dog.vercel.app/preview/offline).

### Custom templates

Any HTML file works. Placeholders are `{{name}}`:

`{{title}}` `{{message}}` `{{targetName}}` `{{targetUrl}}` `{{statusCode}}`
`{{retryAfterSeconds}}` `{{lastChecked}}` `{{year}}`, plus every key under
`fallback.vars`. Values are HTML-escaped, and unknown placeholders render empty.

```json
"fallback": {
  "template": "templates/maintenance.html",
  "vars": { "supportEmail": "support@example.com" }
}
```

[`templates/maintenance.html`](templates/maintenance.html) is a working example.

---

## Library API

```ts
import { loadConfig, Monitor, probeUrl, renderFallbackPage } from 'statusdog';

// One-off check, no config needed.
const result = await probeUrl('https://example.com', { expectStatus: ['2xx'] });

// Long-running monitor.
const monitor = new Monitor(await loadConfig());
monitor.on('down', (e) => console.error(`${e.target.name} is down: ${e.result.message}`));
monitor.on('up', (e) => console.log(`${e.target.name} recovered`));
monitor.start();
```

| Export | Purpose |
| --- | --- |
| `loadConfig(path?)` / `resolveConfig(obj)` | Read and validate configuration |
| `Monitor` | Scheduling, up/down state, history; emits `check`, `up`, `down`, `error` |
| `probe(target)` / `probeUrl(url, overrides?)` | Run a single check; never throws |
| `normalizeCheckUrl(input)` / `isBlockedHost(host)` | Validate user-supplied URLs and reject private address space |
| `HistoryStore` | Ring buffer of results with optional JSON persistence |
| `renderFallbackPage(opts)` / `renderTemplate(html, vars)` | Build a fallback page |
| `startFallbackServer(opts)` / `createFallbackMiddleware(monitor, opts)` | Serve one |
| `startDashboard(monitor, opts)` | Status UI and JSON API |
| `createNotifiers(configs, logger)` / `attachNotifiers(...)` | Alerting |
| `notifiersFromEnv(env?)` / `dispatchTransitions(notifiers, events)` | Env-configured webhooks and settle-not-throw delivery |
| `applyResult(state, result, thresholds)` | The up/down threshold rule, as a pure function |
| `kvFromEnv()` / `createKvClient(opts)` | Redis-over-REST client, or `null` when unconfigured |
| `applyCheck(kv, target, result)` / `readAll(kv, targets)` | Persist and read scheduled-check state |
| `loadRoster(file?)` / `resolveRoster(json)` | Read and validate `monitors.json` |

---

## Project layout

```
src/
  cli.ts            Command-line entry point
  index.ts          Public library exports
  config/           Config loading, defaults, validation, shared types
  monitor/          Probe, expectation matchers, history store, scheduling engine
  store/            KV client, scheduled-check persistence, roster loading
  fallback/         Built-in templates, renderer, standalone server, middleware
  dashboard/        Status UI and JSON API
  notify/           Console and webhook notifiers
  util/             Logging and time formatting
api/                Vercel functions — check, monitors, cron/check, preview, healthz
public/             The hosted site: landing, report, dashboard, docs
monitors.json       The 24/7 roster
scripts/            Local dev server, build-time roster snapshot
templates/          Example custom fallback template
test/               node:test suites
```

Every push and pull request runs typecheck, tests and build on Node 18, 20 and 22
via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Development

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
