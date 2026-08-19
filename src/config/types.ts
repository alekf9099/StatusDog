/**
 * Shared configuration types for StatusDog.
 *
 * `*Config` types describe what a user writes in `statusdog.config.json`.
 * `Resolved*` types describe the same data after defaults have been applied,
 * which is what the monitoring engine actually consumes.
 */

/**
 * An accepted HTTP status. Either an exact code (`200`), a class (`"2xx"`),
 * or an inclusive range (`"200-299"`).
 */
export type ExpectStatus = number | string;

export interface FallbackConfig {
  /** Built-in template name (`maintenance`, `error`, `offline`) or a path to an HTML file. */
  template?: string;
  title?: string;
  message?: string;
  /** Status code served with the fallback page. Defaults to 503. */
  statusCode?: number;
  /** `Retry-After` header value in seconds. Defaults to 120. */
  retryAfterSeconds?: number;
  /** Extra `{{name}}` placeholders made available to the template. */
  vars?: Record<string, string>;
}

export interface TargetConfig {
  /** Stable identifier used by the CLI, API and fallback middleware. */
  id: string;
  name?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Request body, sent as-is. */
  body?: string;
  /** How often to probe, in milliseconds. */
  intervalMs?: number;
  /** Total budget for a probe (including redirects), in milliseconds. */
  timeoutMs?: number;
  /** Statuses considered healthy. Defaults to `["2xx", "3xx"]`. */
  expectStatus?: ExpectStatus[];
  /** Response body must contain this text (or match it, when `expectBodyIsRegex`). */
  expectBody?: string;
  expectBodyIsRegex?: boolean;
  /** Flag the target as unhealthy when a probe is slower than this. `0` disables. */
  maxResponseTimeMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  /** Consecutive failures before the target flips to `down`. */
  failureThreshold?: number;
  /** Consecutive successes before the target flips back to `up`. */
  recoveryThreshold?: number;
  /** Page served for this target while it is down. */
  fallback?: FallbackConfig;
  enabled?: boolean;
}

/** Target defaults; every field is optional and inherited by each target. */
export type TargetDefaults = Omit<Partial<TargetConfig>, 'id' | 'url' | 'name'>;

export interface ConsoleNotifierConfig {
  type: 'console';
}

export interface WebhookNotifierConfig {
  type: 'webhook';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Only notify on these transitions. Defaults to both. */
  on?: Array<'up' | 'down'>;
}

export type NotifierConfig = ConsoleNotifierConfig | WebhookNotifierConfig;

export interface StorageConfig {
  /** JSON file the check history is persisted to. `null` keeps history in memory only. */
  file?: string | null;
  /** Number of records kept per target. */
  historyLimit?: number;
}

export interface DashboardConfig {
  enabled?: boolean;
  host?: string;
  port?: number;
}

export interface StatusDogConfig {
  targets: TargetConfig[];
  defaults?: TargetDefaults;
  storage?: StorageConfig;
  dashboard?: DashboardConfig;
  notifiers?: NotifierConfig[];
  logLevel?: LogLevel;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface ResolvedTarget {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  intervalMs: number;
  timeoutMs: number;
  expectStatus: ExpectStatus[];
  expectBody: string | null;
  expectBodyIsRegex: boolean;
  maxResponseTimeMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  failureThreshold: number;
  recoveryThreshold: number;
  fallback: Required<Omit<FallbackConfig, 'vars'>> & { vars: Record<string, string> };
  enabled: boolean;
}

export interface ResolvedConfig {
  targets: ResolvedTarget[];
  storage: Required<StorageConfig>;
  dashboard: Required<DashboardConfig>;
  notifiers: NotifierConfig[];
  logLevel: LogLevel;
  /** Absolute path the config was loaded from, or `null` for in-memory config. */
  sourcePath: string | null;
}

/** Why a probe was considered a failure. `null` means it succeeded. */
export type FailureReason =
  | 'status'
  | 'body'
  | 'slow'
  | 'timeout'
  | 'dns'
  | 'refused'
  | 'network'
  | 'invalid-url';

export interface TlsInfo {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** Days until the certificate expires; negative once it already has. */
  daysRemaining: number | null;
  protocol: string | null;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

/**
 * Extra context gathered on every probe. The history store ignores it, so it
 * costs nothing to keep around for the diagnostic report.
 */
export interface ProbeDetail {
  /** Curated response headers; anything credential-bearing is dropped. */
  headers: Record<string, string>;
  tls: TlsInfo | null;
  chain: RedirectHop[];
}

export interface ProbeResult {
  url: string;
  /** URL the probe ended on, after redirects. */
  finalUrl: string;
  ok: boolean;
  status: number | null;
  responseTimeMs: number;
  redirects: number;
  checkedAt: string;
  reason: FailureReason | null;
  /** Human-readable explanation when `ok` is false. */
  message: string | null;
  /** Absent when the request never produced a response. */
  detail: ProbeDetail | null;
}
