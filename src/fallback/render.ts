import { readFileSync } from 'node:fs';
import type { ResolvedTarget } from '../config/types.js';
import { formatTimestamp } from '../util/time.js';
import { BUILTIN_TEMPLATES, isBuiltinTemplate } from './templates.js';

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Custom templates are read once and cached — the disk may be unhappy too. */
const fileCache = new Map<string, string>();

export function clearTemplateCache(): void {
  fileCache.clear();
}

/** Load a template by built-in name or file path. */
export function loadTemplate(nameOrPath: string): string {
  const builtin = BUILTIN_TEMPLATES[nameOrPath];
  if (builtin !== undefined) return builtin;

  const cached = fileCache.get(nameOrPath);
  if (cached !== undefined) return cached;

  try {
    const contents = readFileSync(nameOrPath, 'utf8');
    fileCache.set(nameOrPath, contents);
    return contents;
  } catch (err) {
    if (isBuiltinTemplate(nameOrPath)) throw err;
    // Never leave a visitor with a stack trace: degrade to the built-in page.
    const fallback = BUILTIN_TEMPLATES.maintenance!;
    fileCache.set(nameOrPath, fallback);
    return fallback;
  }
}

/** Replace `{{name}}` placeholders. Unknown placeholders are removed. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : escapeHtml(String(value));
  });
}

export interface FallbackPageOptions {
  /** Used for `{{targetName}}` / `{{targetUrl}}` and for the default copy. */
  target?: Pick<ResolvedTarget, 'name' | 'url' | 'fallback'>;
  /** ISO timestamp of the last check. */
  lastChecked?: string | null;
  /** Extra or overriding placeholders. */
  vars?: TemplateVars;
}

export interface RenderedPage {
  html: string;
  statusCode: number;
  retryAfterSeconds: number;
}

/** Build the complete fallback page for a target. */
export function renderFallbackPage(options: FallbackPageOptions = {}): RenderedPage {
  const fallback = options.target?.fallback ?? {
    template: 'maintenance',
    title: 'We will be right back',
    message: 'This service is temporarily unavailable.',
    statusCode: 503,
    retryAfterSeconds: 120,
    vars: {},
  };

  const vars: TemplateVars = {
    title: fallback.title,
    message: fallback.message,
    statusCode: fallback.statusCode,
    retryAfterSeconds: fallback.retryAfterSeconds,
    targetName: options.target?.name ?? 'Service',
    targetUrl: options.target?.url ?? '',
    lastChecked: options.lastChecked ? formatTimestamp(options.lastChecked) : 'never',
    year: new Date().getFullYear(),
    ...fallback.vars,
    ...options.vars,
  };

  return {
    html: renderTemplate(loadTemplate(fallback.template), vars),
    statusCode: Number(vars.statusCode ?? fallback.statusCode),
    retryAfterSeconds: Number(vars.retryAfterSeconds ?? fallback.retryAfterSeconds),
  };
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
