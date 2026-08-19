/**
 * Vercel serverless entry point — serves the StatusDog fallback page.
 *
 * Hosting the maintenance page on Vercel (separate from your own infrastructure)
 * means it is still up when your infrastructure is not: point your DNS or load
 * balancer here during an outage.
 *
 * Every path renders the page; `/healthz` stays 200 so uptime checks can tell
 * the fallback itself apart from the service it is standing in for.
 *
 * Configure it with environment variables in the Vercel dashboard:
 *   STATUSDOG_TEMPLATE      maintenance | error | offline   (default: maintenance)
 *   STATUSDOG_TITLE         page heading
 *   STATUSDOG_MESSAGE       body text
 *   STATUSDOG_SERVICE_NAME  service name shown in the footer
 *   STATUSDOG_STATUS_CODE   HTTP status to serve            (default: 503)
 *   STATUSDOG_RETRY_AFTER   Retry-After seconds             (default: 120)
 */
import { renderFallbackPage } from '../dist/fallback/render.js';

const env = process.env;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function handler(req, res) {
  const pathname = (req.url ?? '/').split('?')[0];

  if (pathname === '/healthz') {
    res.status(200).json({
      status: 'fallback',
      service: env.STATUSDOG_SERVICE_NAME ?? null,
    });
    return;
  }

  const page = renderFallbackPage({
    target: {
      name: env.STATUSDOG_SERVICE_NAME ?? 'Service',
      url: env.STATUSDOG_SERVICE_URL ?? '',
      fallback: {
        template: env.STATUSDOG_TEMPLATE ?? 'maintenance',
        title: env.STATUSDOG_TITLE ?? 'We will be right back',
        message:
          env.STATUSDOG_MESSAGE ??
          'This service is temporarily unavailable. Our team has been notified.',
        statusCode: number(env.STATUSDOG_STATUS_CODE, 503),
        retryAfterSeconds: number(env.STATUSDOG_RETRY_AFTER, 120),
        vars: {},
      },
    },
    lastChecked: null,
  });

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store, must-revalidate');
  res.setHeader('retry-after', String(page.retryAfterSeconds));
  res.status(page.statusCode).send(req.method === 'HEAD' ? '' : page.html);
}
