#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ConfigError, findConfigFile, loadConfig } from './config/index.js';
import type { ProbeResult, ResolvedConfig, StatusDogConfig } from './config/types.js';
import { Monitor } from './monitor/engine.js';
import { probeUrl } from './monitor/probe.js';
import { BUILTIN_TEMPLATE_NAMES } from './fallback/templates.js';
import { startFallbackServer } from './fallback/server.js';
import { startDashboard } from './dashboard/server.js';
import { attachNotifiers, createNotifiers } from './notify/index.js';
import { color, createLogger, type Logger } from './util/log.js';
import { formatDuration, formatRelative } from './util/time.js';

const VERSION = '0.1.0';

const HELP = `${color.bold('StatusDog')} ${color.dim('v' + VERSION)} — uptime monitoring with automated fallback pages

${color.bold('Usage')}
  statusdog <command> [options]

${color.bold('Commands')}
  start                  Run the monitor loop (and the dashboard, unless disabled)
  status                 Check every configured target once and print a table
  check <url>            One-off check of a single URL, no config needed
  list                   List configured targets
  fallback               Serve a fallback/maintenance page on its own port
  init                   Write a starter statusdog.config.json
  help, --help           Show this message
  version, --version     Print the version

${color.bold('Common options')}
  -c, --config <path>    Config file (default: nearest statusdog.config.json)
      --log-level <lvl>  debug | info | warn | error | silent

${color.bold('start')}
      --no-dashboard     Do not start the web dashboard
      --port <n>         Dashboard port (default 4321)
      --host <addr>      Dashboard host (default 127.0.0.1)
      --once             Check every target once, print results, then exit

${color.bold('check')}
      --timeout <ms>     Request timeout (default 10000)
      --expect <list>    Accepted statuses, e.g. 200 or 2xx,3xx (default 2xx,3xx)
      --contains <text>  Require the response body to contain <text>
      --method <verb>    HTTP method (default GET)
      --no-redirects     Do not follow redirects
      --json             Print the raw result as JSON

${color.bold('fallback')}
      --port <n>         Port to listen on (default 8080)
      --host <addr>      Host to bind (default 0.0.0.0)
      --target <id>      Use this target's fallback settings from the config
      --template <name>  ${BUILTIN_TEMPLATE_NAMES.join(' | ')} or a path to an HTML file
      --title <text>     Page heading
      --message <text>   Page body text
      --status <code>    HTTP status to serve (default 503)

${color.bold('Examples')}
  statusdog check https://example.com --expect 200 --json
  statusdog init && statusdog start
  statusdog fallback --port 8080 --template maintenance
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  const valueFlags = new Set([
    'config', 'c', 'log-level', 'port', 'host', 'timeout', 'expect',
    'contains', 'method', 'target', 'template', 'title', 'message', 'status',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = splitOnce(arg.slice(2), '=');
      const key = rawKey!;
      if (inlineValue !== undefined) flags.set(key, inlineValue);
      else if (valueFlags.has(key)) flags.set(key, argv[++i] ?? '');
      else flags.set(key, true);
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      if (valueFlags.has(key)) flags.set(key, argv[++i] ?? '');
      else flags.set(key, true);
      continue;
    }
    positional.push(arg);
  }

  return { command: positional.shift() ?? 'help', positional, flags };
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const index = input.indexOf(separator);
  if (index === -1) return [input, undefined];
  return [input.slice(0, index), input.slice(index + 1)];
}

function flagString(args: Args, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function flagNumber(args: Args, name: string): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliError(`--${name} must be a number, got "${raw}".`);
  return value;
}

class CliError extends Error {
  override name = 'CliError';
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const level = (flagString(args, 'log-level') ?? 'info') as ResolvedConfig['logLevel'];
  const logger = createLogger(level);

  if (args.flags.has('help') || args.flags.has('h')) {
    console.log(HELP);
    return 0;
  }
  if (args.flags.has('version') || args.flags.has('v')) {
    console.log(VERSION);
    return 0;
  }

  switch (args.command) {
    case 'help':
      console.log(HELP);
      return 0;
    case 'version':
      console.log(VERSION);
      return 0;
    case 'check':
      return commandCheck(args, logger);
    case 'init':
      return commandInit(args, logger);
    case 'list':
      return commandList(args, logger);
    case 'status':
      return commandStatus(args, logger);
    case 'start':
      return commandStart(args, logger);
    case 'fallback':
      return commandFallback(args, logger);
    default:
      throw new CliError(`Unknown command "${args.command}". Run "statusdog help".`);
  }
}

async function commandCheck(args: Args, logger: Logger): Promise<number> {
  const url = args.positional[0];
  if (!url) throw new CliError('Usage: statusdog check <url>');

  const expect = flagString(args, 'expect');
  const contains = flagString(args, 'contains');
  const result = await probeUrl(url, {
    method: (flagString(args, 'method') ?? 'GET').toUpperCase(),
    timeoutMs: flagNumber(args, 'timeout') ?? 10_000,
    expectStatus: expect ? expect.split(',').map((s) => s.trim()) : ['2xx', '3xx'],
    expectBody: contains ?? null,
    followRedirects: !args.flags.has('no-redirects'),
  });

  if (args.flags.has('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    logger.print(formatResultLine(url, result));
    if (result.redirects > 0) logger.print(color.dim(`  → followed ${result.redirects} redirect(s) to ${result.finalUrl}`));
    if (result.message) logger.print(color.dim(`  → ${result.message}`));
  }
  return result.ok ? 0 : 1;
}

async function commandInit(args: Args, logger: Logger): Promise<number> {
  const target = path.resolve(flagString(args, 'config') ?? 'statusdog.config.json');
  if (existsSync(target) && !args.flags.has('force')) {
    throw new CliError(`${target} already exists. Pass --force to overwrite.`);
  }

  const starter: StatusDogConfig = {
    defaults: {
      intervalMs: 60_000,
      timeoutMs: 10_000,
      failureThreshold: 2,
      recoveryThreshold: 1,
    },
    targets: [
      {
        id: 'example',
        name: 'Example site',
        url: 'https://example.com',
        expectStatus: ['2xx'],
        fallback: {
          template: 'maintenance',
          title: 'We will be right back',
          message: 'Example site is undergoing maintenance.',
        },
      },
    ],
    storage: { file: 'data/history.json', historyLimit: 500 },
    dashboard: { enabled: true, host: '127.0.0.1', port: 4321 },
    notifiers: [{ type: 'console' }],
  };

  await writeFile(target, JSON.stringify(starter, null, 2) + '\n', 'utf8');
  logger.print(`${color.green('created')} ${path.relative(process.cwd(), target) || target}`);
  logger.print(color.dim('Next: edit the targets, then run "statusdog start".'));
  return 0;
}

async function commandList(args: Args, baseLogger: Logger): Promise<number> {
  const { config, logger } = await loadCli(args, baseLogger);
  logger.print(color.dim(`config: ${config.sourcePath}`));
  for (const target of config.targets) {
    const state = target.enabled ? color.green('enabled ') : color.dim('disabled');
    logger.print(
      `${state} ${color.bold(target.id.padEnd(16))} ${target.url} ` +
        color.dim(`every ${formatDuration(target.intervalMs)}`),
    );
  }
  return 0;
}

async function commandStatus(args: Args, baseLogger: Logger): Promise<number> {
  const { config, logger } = await loadCli(args, baseLogger);
  const monitor = new Monitor(config);
  await monitor.store.load();
  const results = await monitor.checkAll();
  await monitor.store.flush();

  for (const status of monitor.getStatuses()) {
    if (!status.enabled) continue;
    const result = status.lastResult;
    if (!result) continue;
    logger.print(formatResultLine(status.name, result));
    if (result.message) logger.print(color.dim(`  → ${result.message}`));
    if (status.stats.uptimePct !== null) {
      logger.print(
        color.dim(
          `  → ${status.stats.uptimePct}% of last ${status.stats.checks} checks ok, ` +
            `avg ${status.stats.avgResponseTimeMs}ms`,
        ),
      );
    }
  }
  return results.every((r) => r.ok) ? 0 : 1;
}

async function commandStart(args: Args, baseLogger: Logger): Promise<number> {
  if (args.flags.has('once')) return commandStatus(args, baseLogger);
  const { config, logger } = await loadCli(args, baseLogger);

  const monitor = new Monitor(config);
  await monitor.store.load();

  attachNotifiers(monitor, createNotifiers(config.notifiers, logger), logger);
  monitor.on('check', ({ target, result }) => {
    logger.debug(formatResultLine(target.name, result));
  });
  monitor.on('error', (err) => logger.error(err.message));

  const wantDashboard = config.dashboard.enabled && !args.flags.has('no-dashboard');
  let dashboard: Awaited<ReturnType<typeof startDashboard>> | null = null;
  if (wantDashboard) {
    dashboard = await startDashboard(monitor, {
      host: flagString(args, 'host') ?? config.dashboard.host,
      port: flagNumber(args, 'port') ?? config.dashboard.port,
    });
    logger.info(`dashboard on ${color.cyan(dashboard.url)}`);
  }

  monitor.start();
  logger.info(
    `watching ${config.targets.filter((t) => t.enabled).length} target(s) — press Ctrl+C to stop`,
  );

  await waitForShutdown(logger);
  monitor.stop();
  await monitor.store.flush();
  if (dashboard) await dashboard.close();
  logger.info('stopped');
  return 0;
}

async function commandFallback(args: Args, logger: Logger): Promise<number> {
  const targetId = flagString(args, 'target');
  let target: NonNullable<Parameters<typeof startFallbackServer>[0]>['target'];

  if (targetId || findConfigFile()) {
    try {
      const { config } = await loadCli(args, logger);
      const found = targetId
        ? config.targets.find((t) => t.id === targetId)
        : config.targets[0];
      if (targetId && !found) throw new CliError(`Unknown target "${targetId}".`);
      target = found;
    } catch (err) {
      if (targetId) throw err;
      // No usable config is fine here — fall through to CLI flags/defaults.
      logger.debug(`ignoring config: ${(err as Error).message}`);
    }
  }

  const overrides = {
    template: flagString(args, 'template'),
    title: flagString(args, 'title'),
    message: flagString(args, 'message'),
    statusCode: flagNumber(args, 'status'),
  };
  const base = target?.fallback ?? {
    template: 'maintenance',
    title: 'We will be right back',
    message: 'This service is temporarily unavailable. Our team has been notified.',
    statusCode: 503,
    retryAfterSeconds: 120,
    vars: {},
  };
  const merged = {
    name: target?.name ?? 'Service',
    url: target?.url ?? '',
    fallback: {
      ...base,
      ...(overrides.template !== undefined ? { template: overrides.template } : {}),
      ...(overrides.title !== undefined ? { title: overrides.title } : {}),
      ...(overrides.message !== undefined ? { message: overrides.message } : {}),
      ...(overrides.statusCode !== undefined ? { statusCode: overrides.statusCode } : {}),
    },
  };

  const server = await startFallbackServer({
    host: flagString(args, 'host') ?? '0.0.0.0',
    port: flagNumber(args, 'port') ?? 8080,
    target: merged,
  });
  logger.info(
    `fallback page on ${color.cyan(server.url)} ` +
      color.dim(`(HTTP ${merged.fallback.statusCode}, template "${merged.fallback.template}")`),
  );

  await waitForShutdown(logger);
  await server.close();
  logger.info('stopped');
  return 0;
}

/**
 * Load the config and settle the log level: an explicit `--log-level` wins,
 * otherwise the config file's `logLevel` takes over from the default.
 */
async function loadCli(
  args: Args,
  logger: Logger,
): Promise<{ config: ResolvedConfig; logger: Logger }> {
  const config = await loadConfig(flagString(args, 'config', 'c'));
  const explicit = flagString(args, 'log-level');
  return { config, logger: explicit ? logger : createLogger(config.logLevel) };
}

function formatResultLine(label: string, result: ProbeResult): string {
  const badge = result.ok ? color.green('  UP  ') : color.red(' DOWN ');
  const status = result.status === null ? '---' : String(result.status);
  return `${badge} ${label} ${color.dim(`[${status}] ${result.responseTimeMs}ms`)} ` +
    color.dim(formatRelative(result.checkedAt));
}

function waitForShutdown(logger: Logger): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const stop = (signal: string) => () => {
      if (done) return;
      done = true;
      logger.debug(`received ${signal}`);
      resolve();
    };
    process.once('SIGINT', stop('SIGINT'));
    process.once('SIGTERM', stop('SIGTERM'));
  });
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof CliError || err instanceof ConfigError) {
      console.error(color.red('error'), err.message);
    } else {
      console.error(color.red('error'), err);
    }
    process.exitCode = 1;
  });
