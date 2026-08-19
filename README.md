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
| `/dashboard` | Watch a list of URLs, with uptime and response-time history |
| `/docs` | Usage docs |
| `/preview/:template` | Live previews of the fallback screens |

The site is available in English and Korean. It follows the browser language by
default; `?lang=en` or `?lang=ko` overrides it and makes a link shareable in that
language. Strings live in [`public/assets/locales.js`](public/assets/locales.js) —
a test asserts the two tables have identical keys and placeholders, so a missing
translation fails CI rather than showing up as English text on a Korean page.
| `/api/check?url=…` | JSON API for a single check |
| `/api/monitors` | The 24/7 roster with stored state and history |
| `/api/cron/check` | Scheduler entry point (authenticated) |
| `/healthz` | Liveness probe for the site itself |

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

### The scheduler

`POST /api/cron/check` probes every roster target and persists the results.

| Environment variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Shared secret, sent as `Authorization: Bearer …` or `x-cron-secret`. **Unset closes the route rather than opening it.** |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | A Redis-compatible REST store. `UPSTASH_REDIS_REST_*` and `REDIS_REST_*` are also accepted. |
| `STATUSDOG_WEBHOOK_URL` | Optional. Alert webhooks, comma-separated. |
| `STATUSDOG_WEBHOOK_ON` | Optional. `down`, `up`, or `down,up` (default: both). |
| `STATUSDOG_WEBHOOK_FORMAT` | Optional. `full` or `text`; per-host default otherwise. |

[`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) calls it every 15
minutes and needs two repository secrets, `MONITOR_ENDPOINT` and `CRON_SECRET`.
GitHub Actions rather than Vercel Cron because the Hobby plan caps cron at once a
day; on Pro, add a `crons` entry to `vercel.json` and drop the workflow. Either
way, GitHub and Vercel both delay scheduled runs under load, so 15 minutes is a
floor and not a guarantee.

Nothing here is required. With no store configured, `/api/monitors` returns
`storage: "none"`, the dashboard says as much, and the rest of the site is
unaffected.

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
