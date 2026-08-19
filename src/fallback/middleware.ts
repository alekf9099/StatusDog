import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Monitor } from '../monitor/engine.js';
import { renderFallbackPage, type TemplateVars } from './render.js';

export interface FallbackMiddlewareOptions {
  /** Which configured target gates this app. Defaults to the first target. */
  targetId?: string;
  /** Paths that stay live even while the target is down (health checks, webhooks). */
  allowPaths?: Array<string | RegExp>;
  /** Override the decision, e.g. to force a maintenance window on. */
  shouldServeFallback?: (req: IncomingMessage) => boolean;
  vars?: TemplateVars;
}

type Next = (err?: unknown) => void;

/**
 * Connect/Express-compatible middleware that serves the maintenance page while
 * a monitored dependency is down, and gets out of the way once it recovers.
 *
 * ```ts
 * app.use(createFallbackMiddleware(monitor, { targetId: 'payments-api' }));
 * ```
 */
export function createFallbackMiddleware(
  monitor: Monitor,
  options: FallbackMiddlewareOptions = {},
) {
  const targetId = options.targetId ?? monitor.listTargets()[0]?.id;
  if (!targetId) {
    throw new Error('createFallbackMiddleware needs at least one configured target.');
  }
  const target = monitor.getTarget(targetId);
  if (!target) {
    throw new Error(`Unknown target "${targetId}".`);
  }
  const allowPaths = options.allowPaths ?? [];

  return function statusDogFallback(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    const allowed = allowPaths.some((rule) =>
      typeof rule === 'string' ? pathname === rule : rule.test(pathname),
    );
    const serve = options.shouldServeFallback
      ? options.shouldServeFallback(req)
      : monitor.isDown(targetId);

    if (allowed || !serve) {
      next();
      return;
    }

    const page = renderFallbackPage({
      target,
      lastChecked: monitor.getStatus(targetId)?.lastResult?.checkedAt ?? null,
      vars: options.vars,
    });
    res.writeHead(page.statusCode, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(page.html),
      'cache-control': 'no-store, must-revalidate',
      'retry-after': String(page.retryAfterSeconds),
    });
    res.end(req.method === 'HEAD' ? '' : page.html);
  };
}
