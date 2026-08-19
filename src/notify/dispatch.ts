import type { NotifierConfig, WebhookFormat, WebhookNotifierConfig } from '../config/types.js';
import type { TransitionEvent } from '../monitor/transition.js';
import { createNotifiers, type Notifier } from './index.js';

/**
 * Alerting for the serverless scheduler.
 *
 * The long-running CLI reads notifiers from `statusdog.config.json`, but a webhook
 * URL is a credential and has no business in a committed file — so the hosted
 * deployment configures them through the environment instead.
 */

export interface DispatchOutcome {
  notifier: string;
  delivered: boolean;
  error?: string;
}

export interface DispatchSummary {
  transitions: number;
  attempted: number;
  delivered: number;
  failed: number;
  outcomes: DispatchOutcome[];
}

/**
 * Read webhook notifiers from the environment.
 *
 * `STATUSDOG_WEBHOOK_URL`     one or more URLs, comma-separated
 * `STATUSDOG_WEBHOOK_ON`      `down`, `up`, or `down,up` (default: both)
 * `STATUSDOG_WEBHOOK_FORMAT`  `full` or `text`; per-host default otherwise
 *
 * Returns an empty array when nothing is configured, which is not an error —
 * scheduled checks still run and still record history without alerting.
 */
export function notifierConfigsFromEnv(env: NodeJS.ProcessEnv = process.env): NotifierConfig[] {
  const raw = env.STATUSDOG_WEBHOOK_URL;
  if (!raw) return [];

  const on = parseEvents(env.STATUSDOG_WEBHOOK_ON);
  const format = parseFormat(env.STATUSDOG_WEBHOOK_FORMAT);
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '')
    .filter((url) => {
      // A malformed URL should not take the whole check run down.
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    })
    .map((url): WebhookNotifierConfig => ({
      type: 'webhook',
      url,
      on,
      // Left undefined so the notifier applies its per-host default.
      ...(format ? { format } : {}),
    }));
}

function parseFormat(raw: string | undefined): WebhookFormat | undefined {
  const value = raw?.trim().toLowerCase();
  return value === 'full' || value === 'text' ? value : undefined;
}

function parseEvents(raw: string | undefined): Array<'up' | 'down'> | undefined {
  if (!raw) return undefined;
  const events = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is 'up' | 'down' => value === 'up' || value === 'down');
  return events.length > 0 ? events : undefined;
}

export function notifiersFromEnv(env: NodeJS.ProcessEnv = process.env): Notifier[] {
  const configs = notifierConfigsFromEnv(env);
  return configs.length === 0 ? [] : createNotifiers(configs);
}

/**
 * Deliver every transition to every notifier.
 *
 * Settles rather than rejects: a dead webhook must not turn a successful check
 * run into a failed one, so failures come back in the summary instead.
 */
export async function dispatchTransitions(
  notifiers: Notifier[],
  events: TransitionEvent[],
): Promise<DispatchSummary> {
  if (notifiers.length === 0 || events.length === 0) {
    return { transitions: events.length, attempted: 0, delivered: 0, failed: 0, outcomes: [] };
  }

  const outcomes = await Promise.all(
    events.flatMap((event) =>
      notifiers.map(async (notifier): Promise<DispatchOutcome> => {
        try {
          await notifier.notify(event);
          return { notifier: notifier.name, delivered: true };
        } catch (err) {
          return { notifier: notifier.name, delivered: false, error: (err as Error).message };
        }
      }),
    ),
  );

  return {
    transitions: events.length,
    attempted: outcomes.length,
    delivered: outcomes.filter((outcome) => outcome.delivered).length,
    failed: outcomes.filter((outcome) => !outcome.delivered).length,
    outcomes,
  };
}
