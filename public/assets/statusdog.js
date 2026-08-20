/**
 * StatusDog — shared browser helpers.
 *
 * The browser monitor list lives in localStorage, so nothing added on the
 * dashboard is stored on a server and its history only covers checks made while
 * a tab was open. Targets on the server roster are the 24/7 half.
 *
 * Anything user-visible goes through `t()` so both languages stay in step.
 */
import { t } from './i18n.js';

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
  if (!response.ok) {
    throw new Error(payload.error ?? t('error.requestFailed', { status: response.status }));
  }
  return payload;
}

/* ---------- formatting ---------- */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function formatMs(value) {
  // Units stay as symbols: "ms" and "s" read the same in both languages.
  if (value === null || value === undefined) return '–';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function formatRelative(iso) {
  if (!iso) return t('time.never');
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return t('time.never');
  if (delta < 5_000) return t('time.justNow');
  if (delta < 60_000) return t('time.secondsAgo', { n: Math.round(delta / 1000) });
  if (delta < 3_600_000) return t('time.minutesAgo', { n: Math.round(delta / 60_000) });
  if (delta < 86_400_000) return t('time.hoursAgo', { n: Math.round(delta / 3_600_000) });
  return t('time.daysAgo', { n: Math.round(delta / 86_400_000) });
}

/**
 * A span of milliseconds as something readable: `45m`, `2h 15m`, `3d 4h`.
 *
 * Distinct from formatMs, which reports one response time. Downtime is measured in
 * minutes and hours, and "2700000 ms" tells nobody anything.
 */
export function formatDurationMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return t('duration.none');

  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 1) return t('duration.underMinute');
  if (totalMinutes < 60) return t('duration.minutes', { n: totalMinutes });

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes === 0
      ? t('duration.hours', { n: hours })
      : t('duration.hoursMinutes', { h: hours, m: minutes });
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0
    ? t('duration.days', { n: days })
    : t('duration.daysHours', { d: days, h: restHours });
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
  if (!result) return stateBadge('unknown');
  return stateBadge(result.ok ? 'up' : 'down');
}

/** Badge from a state string. The CSS class stays English; only the label moves. */
export function stateBadge(state) {
  const known = state === 'up' || state === 'down';
  const cls = known ? state : '';
  return `<span class="badge ${cls}"><span class="dot"></span>${t(`state.${known ? state : 'unknown'}`)}</span>`;
}

export function sparkline(history = []) {
  if (history.length === 0) {
    return `<div class="spark"><span class="empty-note">${escapeHtml(t('spark.empty'))}</span></div>`;
  }
  const max = Math.max(...history.map((h) => h.ms || 0), 1);
  const bars = history
    .map((h) => {
      const height = Math.max(10, Math.round(((h.ms || 0) / max) * 100));
      const title = `${h.t} · ${h.ok ? t('state.up') : h.reason || t('state.down')} · ${formatMs(h.ms)}`;
      return `<i class="${h.ok ? '' : 'bad'}" style="height:${height}%" title="${escapeHtml(title)}"></i>`;
    })
    .join('');
  return `<div class="spark">${bars}</div>`;
}

/**
 * Fill in the stale-scheduler banner from an /api/monitors payload.
 *
 * Called by every view that shows stored numbers, because the failure this guards
 * against is silent: a scheduler that stopped leaves the last good values in
 * place, and they look exactly like current ones.
 */
export function renderStaleBanner(element, scheduler) {
  if (!element) return;

  if (!scheduler) {
    element.dataset.visible = 'false';
    element.innerHTML = '';
    return;
  }

  if (scheduler.lastRunAt === null) {
    element.dataset.visible = 'true';
    element.textContent = t('stale.bannerNever');
    return;
  }

  if (!scheduler.stale) {
    element.dataset.visible = 'false';
    element.innerHTML = '';
    return;
  }

  element.dataset.visible = 'true';
  element.innerHTML = t('stale.bannerHtml', {
    ago: escapeHtml(formatRelative(scheduler.lastRunAt)),
    // The measured cadence, not the one the cron expression asks for.
    interval: Math.round((scheduler.intervalMs ?? 30 * 60_000) / 60_000),
  });
}

/** Mark the current page in the header nav. Called by each page after initI18n. */
export function markCurrentNav() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  for (const link of document.querySelectorAll('.site-nav a')) {
    const href = link.getAttribute('href');
    if (href === path) link.setAttribute('aria-current', 'page');
  }
}
