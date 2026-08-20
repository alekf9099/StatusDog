import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toPatternList } from '../monitor/assertions.js';
import {
  DASHBOARD_DEFAULTS,
  FALLBACK_DEFAULTS,
  STORAGE_DEFAULTS,
  TARGET_DEFAULTS,
} from './defaults.js';
import type {
  ResolvedConfig,
  ResolvedTarget,
  StatusDogConfig,
  TargetConfig,
  TargetDefaults,
} from './types.js';

export * from './types.js';
export * from './defaults.js';

/** File names probed, in order, when no `--config` is given. */
export const CONFIG_FILENAMES = [
  'statusdog.config.json',
  'statusdog.json',
  '.statusdogrc.json',
];

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Find the nearest config file, walking up from `cwd` to the filesystem root. */
export function findConfigFile(cwd: string = process.cwd()): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function loadConfig(
  configPath?: string,
  cwd: string = process.cwd(),
): Promise<ResolvedConfig> {
  const file = configPath ? path.resolve(cwd, configPath) : findConfigFile(cwd);
  if (!file) {
    throw new ConfigError(
      `No config file found (looked for ${CONFIG_FILENAMES.join(', ')}). Run "statusdog init" to create one.`,
    );
  }
  if (!existsSync(file)) {
    throw new ConfigError(`Config file not found: ${file}`);
  }

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`Could not read ${file}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    throw new ConfigError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }

  return resolveConfig(parsed as StatusDogConfig, file);
}

/** Apply defaults and validate. Exported so configs can be built in code as well. */
export function resolveConfig(
  config: StatusDogConfig,
  sourcePath: string | null = null,
): ResolvedConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigError('Config must be a JSON object.');
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new ConfigError('Config must define a non-empty "targets" array.');
  }

  const baseDir = sourcePath ? path.dirname(sourcePath) : process.cwd();
  const defaults = config.defaults ?? {};
  const seen = new Set<string>();
  const targets = config.targets.map((target, index) => {
    const resolved = resolveTarget(target, defaults, index, baseDir);
    if (seen.has(resolved.id)) {
      throw new ConfigError(`Duplicate target id "${resolved.id}".`);
    }
    seen.add(resolved.id);
    return resolved;
  });

  const storageFile = config.storage?.file;
  return {
    targets,
    stats: {
      timezoneOffsetMinutes: config.stats?.timezoneOffsetMinutes ?? 0,
    },
    storage: {
      file:
        storageFile === null
          ? null
          : path.resolve(baseDir, storageFile ?? STORAGE_DEFAULTS.file!),
      historyLimit: config.storage?.historyLimit ?? STORAGE_DEFAULTS.historyLimit,
    },
    dashboard: { ...DASHBOARD_DEFAULTS, ...config.dashboard },
    notifiers: config.notifiers ?? [{ type: 'console' }],
    logLevel: config.logLevel ?? 'info',
    sourcePath,
  };
}

function resolveTarget(
  target: TargetConfig,
  defaults: TargetDefaults,
  index: number,
  baseDir: string,
): ResolvedTarget {
  if (!target || typeof target !== 'object') {
    throw new ConfigError(`targets[${index}] must be an object.`);
  }
  if (typeof target.url !== 'string' || target.url.trim() === '') {
    throw new ConfigError(`targets[${index}] is missing a "url".`);
  }

  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new ConfigError(`targets[${index}] has an invalid url: ${target.url}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(
      `targets[${index}] must use http or https, got "${url.protocol}".`,
    );
  }

  const id = target.id ?? slugify(url.host + url.pathname);
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new ConfigError(
      `targets[${index}] has an invalid id "${id}" (use letters, digits, dot, dash or underscore).`,
    );
  }

  const pick = <K extends keyof TargetConfig>(key: K): TargetConfig[K] =>
    target[key] ?? (defaults as TargetConfig)[key];

  const expectStatus = pick('expectStatus') ?? TARGET_DEFAULTS.expectStatus;
  if (!Array.isArray(expectStatus) || expectStatus.length === 0) {
    throw new ConfigError(`targets[${index}].expectStatus must be a non-empty array.`);
  }

  const fallbackInput = { ...defaults.fallback, ...target.fallback };
  const template = fallbackInput.template ?? FALLBACK_DEFAULTS.template;

  return {
    id,
    name: target.name ?? id,
    url: target.url,
    method: (pick('method') ?? TARGET_DEFAULTS.method).toUpperCase(),
    headers: { ...defaults.headers, ...target.headers },
    body: pick('body') ?? null,
    intervalMs: positive(pick('intervalMs') ?? TARGET_DEFAULTS.intervalMs, `targets[${index}].intervalMs`),
    timeoutMs: positive(pick('timeoutMs') ?? TARGET_DEFAULTS.timeoutMs, `targets[${index}].timeoutMs`),
    expectStatus,
    expectBody: pick('expectBody') ?? null,
    expectBodyIsRegex: pick('expectBodyIsRegex') ?? TARGET_DEFAULTS.expectBodyIsRegex,
    forbidBody: toPatternList(pick('forbidBody')),
    forbidBodyIsRegex: pick('forbidBodyIsRegex') ?? false,
    // Header names are lowercased once here, so the probe can look them up directly.
    expectHeaders: normalizeHeaderExpectations(
      { ...defaults.expectHeaders, ...target.expectHeaders },
      `targets[${index}].expectHeaders`,
    ),
    expectRedirects: hopCount(pick('expectRedirects'), `targets[${index}].expectRedirects`),
    expectFinalUrl: pick('expectFinalUrl') ?? null,
    maxResponseTimeMs: pick('maxResponseTimeMs') ?? TARGET_DEFAULTS.maxResponseTimeMs,
    followRedirects: pick('followRedirects') ?? TARGET_DEFAULTS.followRedirects,
    maxRedirects: pick('maxRedirects') ?? TARGET_DEFAULTS.maxRedirects,
    failureThreshold: positive(
      pick('failureThreshold') ?? TARGET_DEFAULTS.failureThreshold,
      `targets[${index}].failureThreshold`,
    ),
    recoveryThreshold: positive(
      pick('recoveryThreshold') ?? TARGET_DEFAULTS.recoveryThreshold,
      `targets[${index}].recoveryThreshold`,
    ),
    certExpiryWarnDays: certDays(
      pick('certExpiryWarnDays') ?? TARGET_DEFAULTS.certExpiryWarnDays,
      `targets[${index}].certExpiryWarnDays`,
    ),
    fallback: {
      // A template name stays as-is; anything that looks like a path is resolved
      // relative to the config file so configs are portable.
      template: isBuiltinTemplateName(template) ? template : path.resolve(baseDir, template),
      title: fallbackInput.title ?? FALLBACK_DEFAULTS.title,
      message: fallbackInput.message ?? FALLBACK_DEFAULTS.message,
      statusCode: fallbackInput.statusCode ?? FALLBACK_DEFAULTS.statusCode,
      retryAfterSeconds: fallbackInput.retryAfterSeconds ?? FALLBACK_DEFAULTS.retryAfterSeconds,
      vars: fallbackInput.vars ?? {},
    },
    enabled: pick('enabled') ?? TARGET_DEFAULTS.enabled,
  };
}

function isBuiltinTemplateName(name: string): boolean {
  return /^[a-z0-9-]+$/i.test(name) && !name.includes('.');
}

function normalizeHeaderExpectations(
  input: Record<string, true | string> | undefined,
  label: string,
): Record<string, true | string> {
  const out: Record<string, true | string> = {};
  for (const [name, expected] of Object.entries(input ?? {})) {
    if (expected !== true && typeof expected !== 'string') {
      throw new ConfigError(
        `${label}.${name} must be true (present) or a string (contains), got ${JSON.stringify(expected)}.`,
      );
    }
    out[name.toLowerCase()] = expected;
  }
  return out;
}

function hopCount(value: number | undefined, label: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ConfigError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** An empty list is meaningful — it turns the warnings off — so only shape is checked. */
function certDays(value: number[], label: string): number[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${label} must be an array of days.`);
  }
  for (const day of value) {
    if (typeof day !== 'number' || !Number.isFinite(day) || day < 0) {
      throw new ConfigError(`${label} must contain non-negative numbers, got ${JSON.stringify(day)}.`);
    }
  }
  return [...new Set(value)].sort((a, b) => a - b);
}

function positive(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${label} must be a positive number, got ${JSON.stringify(value)}.`);
  }
  return value;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'target';
}

/** Allow `//` and `/* *\/` comments so configs can be annotated. */
function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += input[i + 1] ?? ''; i++; }
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }
  return out;
}
