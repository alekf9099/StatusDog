import http from 'node:http';
import type { ResolvedTarget } from '../config/types.js';
import { renderFallbackPage, type TemplateVars } from './render.js';

export interface FallbackServerOptions {
  host?: string;
  port?: number;
  target?: Pick<ResolvedTarget, 'name' | 'url' | 'fallback'>;
  vars?: TemplateVars;
  /** Answer `/healthz` with 200 JSON so orchestrators know the process is alive. */
  healthPath?: string | null;
}

export interface FallbackServer {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * A standalone server that answers every request with the fallback page.
 *
 * Point a load balancer here (or run it on the app's port) while the real
 * service is down.
 */
export function startFallbackServer(
  options: FallbackServerOptions = {},
): Promise<FallbackServer> {
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? 8080;
  const healthPath = options.healthPath === undefined ? '/healthz' : options.healthPath;

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    if (healthPath && pathname === healthPath) {
      const payload = JSON.stringify({ status: 'fallback', service: options.target?.name ?? null });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }

    const page = renderFallbackPage({ target: options.target, vars: options.vars });
    const body = req.method === 'HEAD' ? '' : page.html;
    res.writeHead(page.statusCode, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(page.html),
      'cache-control': 'no-store, must-revalidate',
      'retry-after': String(page.retryAfterSeconds),
    });
    res.end(body);
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
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done())),
          ),
      });
    });
  });
}
