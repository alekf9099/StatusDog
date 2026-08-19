import http from 'node:http';
import https from 'node:https';
import { USER_AGENT } from '../config/defaults.js';
import type { NotifierConfig, WebhookFormat, WebhookNotifierConfig } from '../config/types.js';
import type { Monitor } from '../monitor/engine.js';
import type { TransitionEvent } from '../monitor/transition.js';
import { color, createLogger, type Logger } from '../util/log.js';

export interface Notifier {
  readonly name: string;
  notify(event: TransitionEvent): Promise<void>;
}

export function createNotifier(config: NotifierConfig, logger: Logger = createLogger('info')): Notifier {
  switch (config.type) {
    case 'console':
      return createConsoleNotifier(logger);
    case 'webhook':
      return createWebhookNotifier(config, logger);
    default: {
      const unknown = config as { type?: string };
      throw new Error(`Unknown notifier type "${unknown.type}".`);
    }
  }
}

export function createNotifiers(
  configs: NotifierConfig[],
  logger: Logger = createLogger('info'),
): Notifier[] {
  return configs.map((config) => createNotifier(config, logger));
}

/** Wire notifiers to a monitor's up/down transitions. Returns a detach function. */
export function attachNotifiers(monitor: Monitor, notifiers: Notifier[], logger: Logger): () => void {
  const handler = (event: TransitionEvent) => {
    for (const notifier of notifiers) {
      // Alerting must never block or crash the check loop.
      notifier.notify(event).catch((err: unknown) => {
        logger.warn(`notifier "${notifier.name}" failed:`, (err as Error).message);
      });
    }
  };
  monitor.on('up', handler);
  monitor.on('down', handler);
  return () => {
    monitor.off('up', handler);
    monitor.off('down', handler);
  };
}

function createConsoleNotifier(logger: Logger): Notifier {
  return {
    name: 'console',
    async notify(event) {
      const label = event.to === 'up' ? color.green('RECOVERED') : color.red('DOWN');
      const detail = event.result.message ?? `HTTP ${event.result.status ?? '-'}`;
      logger.info(`${label} ${event.target.name} (${event.target.url}) — ${detail}`);
    },
  };
}

/**
 * Hosts whose APIs reject a request outright when it carries fields they do not
 * recognise, so only the one-line summary can be sent.
 */
const TEXT_ONLY_HOSTS = new Set(['chat.googleapis.com']);

export function defaultWebhookFormat(url: string): WebhookFormat {
  try {
    return TEXT_ONLY_HOSTS.has(new URL(url).hostname) ? 'text' : 'full';
  } catch {
    return 'full';
  }
}

function createWebhookNotifier(config: WebhookNotifierConfig, logger: Logger): Notifier {
  const events = config.on ?? ['up', 'down'];
  const format = config.format ?? defaultWebhookFormat(config.url);
  // A webhook URL's path is the credential, so only the origin is ever named.
  // Delivery outcomes are returned over HTTP by the scheduled endpoint.
  const label = `webhook(${originOf(config.url)})`;

  return {
    name: label,
    async notify(event) {
      if (!events.includes(event.to === 'up' ? 'up' : 'down')) return;

      const summary =
        `${event.to === 'up' ? 'Recovered' : 'Down'}: ${event.target.name} (${event.target.url})` +
        (event.result.message ? ` — ${event.result.message}` : '');

      const payload = JSON.stringify(
        format === 'text'
          ? { text: summary }
          : {
              event: event.to,
              target: { id: event.target.id, name: event.target.name, url: event.target.url },
              previousState: event.from,
              result: event.result,
              at: event.at,
              // `text` is what Slack renders, `content` is what Discord renders.
              // Both ignore keys they do not know, so one body serves either.
              text: summary,
              content: summary,
            },
      );

      await postJson(config.url, payload, config.method ?? 'POST', config.headers ?? {});
      logger.debug(`webhook delivered to ${label} (${format})`);
    },
  };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-url';
  }
}

function postJson(
  urlString: string,
  payload: string,
  method: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`Invalid webhook url: ${urlString}`));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'user-agent': USER_AGENT,
          ...headers,
        },
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`webhook responded ${status}`));
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error('webhook timed out')));
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}
