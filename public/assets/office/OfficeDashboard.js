/**
 * OfficeDashboard — the floor, and who is on it.
 *
 * Pulls from both halves of StatusDog and gives each a different job title,
 * because the difference is real rather than cosmetic:
 *
 *   staff  — targets on the server roster, checked every 15 minutes whether or
 *            not anyone is looking. Their history survives a closed tab.
 *   intern — monitors you added in this browser. They only work while the tab is
 *            open, and their notes are gone when localStorage is cleared.
 *
 * Re-renders the whole floor per poll and reconciles nothing: five to twenty
 * desks of static markup is cheaper to replace than to diff, and CSS animations
 * restart imperceptibly. The open report is updated in place instead, so it does
 * not shut under the reader.
 */
import { check, escapeHtml, store } from '../statusdog.js';
import { t } from '../i18n.js';
import { deriveMood, officeSummary } from './mood.js';
import { makeWorker, renderDogWorkerCard } from './DogWorkerCard.js';
import { ServerReportModal } from './ServerReportModal.js';

const POLL_MS = 60_000;

export class OfficeDashboard {
  /**
   * @param {{ room: HTMLElement, floor: HTMLElement, board: HTMLElement }} elements
   */
  constructor({ room, floor, board }) {
    this.room = room;
    this.floor = floor;
    this.board = board;

    this.report = new ServerReportModal();
    /** @type {Array<{monitor: object, mood: object, dog: object}>} */
    this.workers = [];
    this.serverPayload = null;
    this.serverError = null;

    this.floor.addEventListener('click', (event) => {
      const desk = event.target.closest('.desk');
      if (!desk) return;
      const worker = this.workers.find((candidate) => candidate.monitor.uid === desk.dataset.workerId);
      if (worker) this.report.open(worker, desk);
    });

    document.addEventListener('statusdog:languagechange', () => this.render());
  }

  start() {
    void this.refresh();
    setInterval(() => void this.refresh(), POLL_MS);
  }

  /** Fetch roster state, run the browser monitors, then redraw. */
  async refresh() {
    await Promise.all([this.loadStaff(), this.runInterns()]);
    this.render();
  }

  async loadStaff() {
    try {
      const response = await fetch('/api/monitors?history=60', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t('error.requestFailed', { status: response.status }));
      }
      this.serverPayload = payload;
      this.serverError = null;
    } catch (err) {
      this.serverPayload = null;
      this.serverError = err.message;
    }
  }

  /** Interns do their own checking; the browser is their only employer. */
  async runInterns() {
    const monitors = store.list();
    if (monitors.length === 0) return;

    await Promise.all(monitors.map(async (monitor) => {
      try {
        store.record(monitor.id, await check(monitor.url));
      } catch (err) {
        // A rejected request is itself a result — record it rather than lose it.
        store.record(monitor.id, {
          url: monitor.url,
          ok: false,
          status: null,
          responseTimeMs: 0,
          redirects: 0,
          checkedAt: new Date().toISOString(),
          reason: 'network',
          message: err.message,
          detail: null,
        });
      }
    }));
  }

  /**
   * Normalise both sources into the one shape a desk understands.
   * `uid` is namespaced because a roster id and a browser id could collide.
   */
  collectWorkers() {
    const workers = [];

    for (const monitor of this.serverPayload?.monitors ?? []) {
      const normalised = { ...monitor, uid: `staff:${monitor.id}`, kind: 'staff' };
      workers.push(makeWorker(normalised, deriveMood(normalised)));
    }

    for (const monitor of store.list()) {
      const normalised = {
        id: monitor.id,
        uid: `intern:${monitor.id}`,
        kind: 'intern',
        // A browser monitor has no display name, so the host stands in for one.
        name: monitor.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        url: monitor.url,
        state: monitor.lastResult ? (monitor.lastResult.ok ? 'up' : 'down') : 'unknown',
        since: null,
        consecutiveFailures: monitor.lastResult && !monitor.lastResult.ok ? 1 : 0,
        maxResponseTimeMs: 0,
        lastResult: monitor.lastResult ?? null,
        stats: statsFromHistory(monitor.history ?? []),
        history: monitor.history ?? [],
      };
      workers.push(makeWorker(normalised, deriveMood(normalised)));
    }

    return workers;
  }

  render() {
    this.workers = this.collectWorkers();
    const summary = officeSummary(this.workers);

    this.room.dataset.worst = summary.worst;
    this.board.innerHTML = this.renderBoard(summary);

    this.floor.innerHTML = this.workers.length === 0
      ? `<div class="office-empty">${t('office.emptyHtml')}</div>`
      : `<div class="office-floor">${this.workers.map(renderDogWorkerCard).join('')}</div>`;

    // Keep an open report in step with the poll it did not ask for.
    const open = this.report.worker;
    if (open) {
      const fresh = this.workers.find((worker) => worker.monitor.uid === open.monitor.uid);
      if (fresh) this.report.update(fresh);
    }
  }

  renderBoard(summary) {
    if (this.serverError) {
      return `<strong>${escapeHtml(t('office.board.offline'))}</strong> ${escapeHtml(this.serverError)}`;
    }
    if (this.serverPayload?.storage === 'none') {
      return t('office.board.noStorageHtml');
    }
    if (summary.total === 0) {
      return `<strong>${escapeHtml(t('office.board.emptyTitle'))}</strong> ${escapeHtml(t('office.board.emptyHint'))}`;
    }

    const headcount = t('office.board.headcount', { count: summary.total });
    const parts = [];
    if (summary.counts.alarmed) parts.push(t('office.board.alarmed', { count: summary.counts.alarmed }));
    if (summary.counts.uneasy) parts.push(t('office.board.uneasy', { count: summary.counts.uneasy }));
    if (summary.counts.strained) parts.push(t('office.board.strained', { count: summary.counts.strained }));
    if (summary.counts.offDuty) parts.push(t('office.board.offDuty', { count: summary.counts.offDuty }));

    const mood = parts.length === 0 ? t('office.board.allCalm') : parts.join(' · ');
    return `<strong>${escapeHtml(headcount)}</strong> — ${escapeHtml(mood)}`;
  }
}

/** Interns keep no stats of their own, so derive them from their notes. */
function statsFromHistory(history) {
  if (history.length === 0) {
    return { checks: 0, uptimePct: null, avgResponseTimeMs: null, lastCheckedAt: null };
  }
  const ok = history.filter((record) => record.ok).length;
  const total = history.reduce((sum, record) => sum + (record.ms || 0), 0);
  return {
    checks: history.length,
    uptimePct: Math.round((ok / history.length) * 10_000) / 100,
    avgResponseTimeMs: Math.round(total / history.length),
    lastCheckedAt: history[history.length - 1].t,
  };
}
