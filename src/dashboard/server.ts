import http from 'node:http';
import type { Monitor } from '../monitor/engine.js';
import { renderFallbackPage } from '../fallback/render.js';
import { DASHBOARD_HTML } from './html.js';

export interface DashboardOptions {
  host?: string;
  port?: number;
}

export interface DashboardServer {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * Read-only status UI plus a small JSON API:
 *
 * - `GET  /`                       dashboard
 * - `GET  /api/status[?history=N]` every target with recent history
 * - `GET  /api/history?target=id`  full retained history for one target
 * - `GET  /api/preview?target=id`  preview a target's fallback page
 * - `POST /api/check[?target=id]`  run checks immediately
 */
export function startDashboard(
  monitor: Monitor,
  options: DashboardOptions = {},
): Promise<DashboardServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4321;

  const server = http.createServer((req, res) => {
    void handle(monitor, req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: (err as Error).message });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        host,
        port: boundPort,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort}`,
        close: () =>
          new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
  });
}

async function handle(
  monitor: Monitor,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    sendHtml(res, 200, DASHBOARD_HTML);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/status') {
    const historyLimit = clampInt(url.searchParams.get('history'), 0, 1000, 40);
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      targets: monitor.getStatuses().map((status) => ({
        status,
        history: historyLimit > 0 ? monitor.history(status.id, historyLimit) : [],
      })),
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/history') {
    const id = url.searchParams.get('target');
    if (!id || !monitor.getTarget(id)) {
      sendJson(res, 404, { error: `Unknown target "${id ?? ''}".` });
      return;
    }
    const limit = clampInt(url.searchParams.get('limit'), 1, 5000, 200);
    sendJson(res, 200, { target: id, records: monitor.history(id, limit) });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/preview') {
    const id = url.searchParams.get('target');
    const target = id ? monitor.getTarget(id) : monitor.listTargets()[0];
    if (!target) {
      sendJson(res, 404, { error: `Unknown target "${id ?? ''}".` });
      return;
    }
    const page = renderFallbackPage({
      target,
      lastChecked: monitor.getStatus(target.id)?.lastResult?.checkedAt ?? null,
    });
    // Preview always returns 200 so browsers render it like a normal page.
    sendHtml(res, 200, page.html);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/check') {
    const id = url.searchParams.get('target');
    if (id) {
      if (!monitor.getTarget(id)) {
        sendJson(res, 404, { error: `Unknown target "${id}".` });
        return;
      }
      sendJson(res, 200, { results: [await monitor.check(id)] });
      return;
    }
    sendJson(res, 200, { results: await monitor.checkAll() });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = Number(raw);
  if (raw === null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
