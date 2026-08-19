import type { LogLevel } from '../config/types.js';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

const ESC = String.fromCharCode(27);

function paint(code: number, text: string): string {
  return useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

export const color = {
  dim: (t: string) => paint(2, t),
  red: (t: string) => paint(31, t),
  green: (t: string) => paint(32, t),
  yellow: (t: string) => paint(33, t),
  blue: (t: string) => paint(34, t),
  cyan: (t: string) => paint(36, t),
  bold: (t: string) => paint(1, t),
};

export interface Logger {
  level: LogLevel;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Write a line with no level prefix (for CLI output). */
  print(...args: unknown[]): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const enabled = (l: LogLevel) => LEVELS[l] >= LEVELS[level];
  const stamp = () => color.dim(new Date().toISOString().replace('T', ' ').slice(0, 19));

  return {
    level,
    debug: (...args) => {
      if (enabled('debug')) console.error(stamp(), color.dim('debug'), ...args);
    },
    info: (...args) => {
      if (enabled('info')) console.error(stamp(), color.cyan('info '), ...args);
    },
    warn: (...args) => {
      if (enabled('warn')) console.error(stamp(), color.yellow('warn '), ...args);
    },
    error: (...args) => {
      if (enabled('error')) console.error(stamp(), color.red('error'), ...args);
    },
    print: (...args) => {
      if (level !== 'silent') console.log(...args);
    },
  };
}
