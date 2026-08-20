import type { DashboardConfig, StorageConfig, TargetDefaults } from './types.js';

/**
 * Engine-wide defaults.
 *
 * The assertion fields are omitted deliberately: forbidBody, expectHeaders,
 * expectRedirects and expectFinalUrl are per-target opt-ins, and "no expectation"
 * is expressed by their absence rather than by a global value.
 */
export const TARGET_DEFAULTS: Required<
  Omit<
    TargetDefaults,
    | 'headers'
    | 'body'
    | 'expectBody'
    | 'fallback'
    | 'forbidBody'
    | 'forbidBodyIsRegex'
    | 'expectHeaders'
    | 'expectRedirects'
    | 'expectFinalUrl'
  >
> = {
  method: 'GET',
  intervalMs: 60_000,
  timeoutMs: 10_000,
  expectStatus: ['2xx', '3xx'],
  expectBodyIsRegex: false,
  maxResponseTimeMs: 0,
  followRedirects: true,
  maxRedirects: 5,
  failureThreshold: 2,
  recoveryThreshold: 1,
  // Two warnings a month out, then tightening. Each fires once per certificate.
  certExpiryWarnDays: [30, 14, 7, 3, 1],
  enabled: true,
};

export const FALLBACK_DEFAULTS = {
  template: 'maintenance',
  title: 'We will be right back',
  message: 'This service is temporarily unavailable. Our team has been notified.',
  statusCode: 503,
  retryAfterSeconds: 120,
} as const;

export const STORAGE_DEFAULTS: Required<StorageConfig> = {
  file: 'data/history.json',
  historyLimit: 500,
};

export const DASHBOARD_DEFAULTS: Required<DashboardConfig> = {
  enabled: true,
  host: '127.0.0.1',
  port: 4321,
};

export const USER_AGENT = 'StatusDog/0.1 (+https://github.com/alekf9099/StatusDog)';
