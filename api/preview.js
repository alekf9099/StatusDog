/**
 * `GET /preview/:template` — live demo of the fallback/maintenance screens.
 *
 * Served with `200` rather than the template's own status code: this is a
 * preview, not an outage, and a browser should render it like any other page.
 */
import { renderFallbackPage } from '../dist/fallback/render.js';
import { BUILTIN_TEMPLATE_NAMES, isBuiltinTemplate } from '../dist/fallback/templates.js';

const COPY = {
  maintenance: {
    title: 'We will be right back',
    message: 'Scheduled maintenance is in progress. Everything will be back shortly.',
  },
  error: {
    title: 'Something went wrong',
    message: 'The service returned an unexpected error. Our team has been notified.',
  },
  offline: {
    title: 'Service offline',
    message: 'This service is offline right now. We are working on bringing it back.',
  },
};

export default function handler(req, res) {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const requested = query.get('template') ?? 'maintenance';

  if (!isBuiltinTemplate(requested)) {
    res.status(404).json({
      error: `Unknown template "${requested}".`,
      available: BUILTIN_TEMPLATE_NAMES,
    });
    return;
  }

  const copy = COPY[requested] ?? COPY.maintenance;
  const page = renderFallbackPage({
    target: {
      name: query.get('service') ?? 'Example service',
      url: '',
      fallback: {
        template: requested,
        title: query.get('title') ?? copy.title,
        message: query.get('message') ?? copy.message,
        statusCode: requested === 'error' ? 500 : 503,
        retryAfterSeconds: 120,
        vars: {},
      },
    },
    lastChecked: new Date().toISOString(),
  });

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(200).send(page.html);
}
