/** Format a duration in milliseconds as a compact human string (`1.2s`, `3m 04s`). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${String(hours % 24).padStart(2, '0')}h`;
}

/** `2026-08-19 14:03:11` in local time. */
export function formatTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** `4m ago`, `just now`. */
export function formatRelative(value: string | number | Date, now = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const delta = now - date.getTime();
  if (delta < 5_000) return 'just now';
  return `${formatDuration(delta)} ago`;
}
