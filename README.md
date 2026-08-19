# StatusDog

A lightweight monitoring and automated fallback/error screen management tool.

StatusDog pings your sites and APIs on a schedule, decides when they are really
down (not just having a bad second), and serves a proper maintenance page in the
meantime — either as standalone server or as middleware inside your own app.

- **Zero runtime dependencies.** Node's built-in `http`/`https` only.
- **Three ways to use it:** CLI, embeddable library, or a standalone fallback server.
- **Self-contained pages.** The dashboard and fallback templates are single HTML
  documents with no external requests — they still render when everything else is down.

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

### On Vercel

A maintenance page hosted on your own infrastructure is down exactly when you
need it. This repo therefore deploys as a Vercel project that answers every path
with the fallback page — point your DNS or load balancer at it during an outage.

1. Import the repository at <https://vercel.com/new>. [`vercel.json`](vercel.json)
   already sets the build command and routes every path to
   [`api/index.js`](api/index.js), so no further configuration is needed.
2. Every push to `main` deploys to production, and every pull request gets its
   own preview URL.
3. Customise the page with environment variables in the Vercel dashboard:

| Variable | Default | Meaning |
| --- | --- | --- |
| `STATUSDOG_TEMPLATE` | `maintenance` | `maintenance`, `error` or `offline` |
| `STATUSDOG_TITLE` | `We will be right back` | Page heading |
| `STATUSDOG_MESSAGE` | generic apology | Body text |
| `STATUSDOG_SERVICE_NAME` | `Service` | Name shown in the footer |
| `STATUSDOG_SERVICE_URL` | — | URL of the service being stood in for |
| `STATUSDOG_STATUS_CODE` | `503` | Status served with the page |
| `STATUSDOG_RETRY_AFTER` | `120` | `Retry-After` header and auto-refresh interval |

`/healthz` answers `200` so an uptime check can tell the fallback apart from the
service it is standing in for.

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
| `HistoryStore` | Ring buffer of results with optional JSON persistence |
| `renderFallbackPage(opts)` / `renderTemplate(html, vars)` | Build a fallback page |
| `startFallbackServer(opts)` / `createFallbackMiddleware(monitor, opts)` | Serve one |
| `startDashboard(monitor, opts)` | Status UI and JSON API |
| `createNotifiers(configs, logger)` / `attachNotifiers(...)` | Alerting |

---

## Project layout

```
src/
  cli.ts            Command-line entry point
  index.ts          Public library exports
  config/           Config loading, defaults, validation, shared types
  monitor/          Probe, expectation matchers, history store, scheduling engine
  fallback/         Built-in templates, renderer, standalone server, middleware
  dashboard/        Status UI and JSON API
  notify/           Console and webhook notifiers
  util/             Logging and time formatting
api/index.js        Vercel serverless entry point for the fallback page
public/             Static assets served by Vercel
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
