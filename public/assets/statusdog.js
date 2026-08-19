/**
 * StatusDog — shared browser helpers.
 *
 * The monitor list lives in localStorage: stage one of this site runs without a
 * database, so nothing you add here is stored on a server. That also means
 * uptime history only covers checks made while a tab was open — real 24/7
 * history needs the CLI (or a database-backed deployment).
 */

const STORAGE_KEY = 'statusdog.monitors.v1';
const HISTORY_LIMIT = 40;

export const store = {
  list() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  save(monitors) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(monitors));
  },

  /** Returns the monitor, whether it was newly added or already present. */
  add(url) {
    const monitors = store.list();
    const existing = monitors.find((m) => m.url === url);
    if (existing) return { monitor: existing, added: false };

    const monitor = { id: cryptoId(), url, addedAt: new Date().toISOString(), history: [] };
    monitors.push(monitor);
    store.save(monitors);
    return { monitor, added: true };
  },

  remove(id) {
    store.save(store.list().filter((m) => m.id !== id));
  },

  record(id, result) {
    const monitors = store.list();
    const monitor = monitors.find((m) => m.id === id);
    if (!monitor) return;
    monitor.history = [
      ...(monitor.history ?? []),
      { t: result.checkedAt, ok: result.ok, status: result.status, ms: result.responseTimeMs, reason: result.reason },
    ].slice(-HISTORY_LIMIT);
    monitor.lastResult = result;
    store.save(monitors);
  },
};

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `m_${Math.random().toString(36).slice(2, 10)}`;
}

/** Run a check through the API. Rejects only on transport/validation errors. */
export async function check(url, options = {}) {
  const params = new URLSearchParams({ url });
  if (options.expect) params.set('expect', options.expect);
  if (options.contains) params.set('contains', options.contains);
  if (options.timeout) params.set('timeout', String(options.timeout));

  const response = await fetch(`/api/check?${params}`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

/* ---------- formatting ---------- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function formatMs(value) {
  if (value === null || value === undefined) return '–';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function formatRelative(iso) {
  if (!iso) return 'never';
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return 'never';
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

/** `https://example.com/path` → `example.com/path` */
export function prettyUrl(url) {
  return String(url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function uptimePct(history = []) {
  if (history.length === 0) return null;
  const ok = history.filter((h) => h.ok).length;
  return Math.round((ok / history.length) * 1000) / 10;
}

export function statusBadge(result) {
  if (!result) return '<span class="badge"><span class="dot"></span>unknown</span>';
  const cls = result.ok ? 'up' : 'down';
  const label = result.ok ? 'up' : 'down';
  return `<span class="badge ${cls}"><span class="dot"></span>${label}</span>`;
}

export function sparkline(history = []) {
  if (history.length === 0) {
    return '<div class="spark"><span class="empty-note">No checks yet</span></div>';
  }
  const max = Math.max(...history.map((h) => h.ms || 0), 1);
  const bars = history
    .map((h) => {
      const height = Math.max(10, Math.round(((h.ms || 0) / max) * 100));
      const title = `${h.t} · ${h.ok ? 'ok' : h.reason || 'failed'} · ${formatMs(h.ms)}`;
      return `<i class="${h.ok ? '' : 'bad'}" style="height:${height}%" title="${escapeHtml(title)}"></i>`;
    })
    .join('');
  return `<div class="spark">${bars}</div>`;
}

/** Mark the current page in the header nav. */
export function markCurrentNav() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  for (const link of document.querySelectorAll('.site-nav a')) {
    const href = link.getAttribute('href');
    if (href === path) link.setAttribute('aria-current', 'page');
  }
}

markCurrentNav();
