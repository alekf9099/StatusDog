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
import { dogOverrides } from './overrides.js';
import { randomDogAssignment } from './dogs.js';
import { normalizeUrlForDisplay } from './url.js';

const POLL_MS = 60_000;

export class OfficeDashboard {
  /**
   * @param {{ room: HTMLElement, floor: HTMLElement, board: HTMLElement }} elements
   */
  constructor({ room, floor, board, hireForm, hireUrl, hireName, hireSubmit, hireError }) {
    this.room = room;
    this.floor = floor;
    this.board = board;
    this.hire = { form: hireForm, url: hireUrl, name: hireName, submit: hireSubmit, error: hireError };

    /** uids seen in a previous render, so only genuinely new dogs animate in. */
    this.seen = new Set();
    /** uids to flag as arriving on the next render only. */
    this.arriving = new Set();

    this.report = new ServerReportModal({
      onRename: (uid, name) => {
        dogOverrides.rename(uid, name);
        this.render();
      },
      onReroll: (uid) => {
        dogOverrides.patch(uid, randomDogAssignment());
        this.render();
      },
      onDismiss: (uid) => {
        const id = uid.startsWith('intern:') ? uid.slice('intern:'.length) : null;
        if (id) store.remove(id);
        dogOverrides.forget(uid);
        this.render();
      },
    });
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

    this.hire.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.hireDog();
    });
  }

  /**
   * Add a site and give it a dog.
   *
   * The look is rolled once, here, and stored — not derived per render. A
   * colleague you cannot recognise tomorrow is not a colleague, and a hash of the
   * URL would also mean two sites could coincidentally share a face.
   */
  async hireDog() {
    const { form, url, name, submit, error } = this.hire;
    if (!form) return;

    const raw = url.value.trim();
    if (raw === '') return;

    const display = normalizeUrlForDisplay(raw);
    if (!display) {
      this.showHireError(t('office.hire.invalid'));
      return;
    }

    error.hidden = true;
    submit.disabled = true;
    submit.textContent = t('office.hire.hiring');

    try {
      const { monitor, added } = store.add(display);
      const uid = `intern:${monitor.id}`;

      if (!added) {
        this.showHireError(t('office.hire.duplicate'));
        return;
      }

      dogOverrides.patch(uid, {
        ...randomDogAssignment(),
        ...(name.value.trim() === '' ? {} : { name: name.value }),
      });

      this.arriving.add(uid);
      url.value = '';
      name.value = '';
      this.render();

      // Give the new dog something to report as soon as it sits down.
      await this.runIntern(monitor);
      this.render();
    } finally {
      submit.disabled = false;
      submit.textContent = t('office.hire.submit');
    }
  }

  showHireError(message) {
    const { error } = this.hire;
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
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
    await Promise.all(monitors.map((monitor) => this.runIntern(monitor)));
  }

  async runIntern(monitor) {
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
  }

  /**
   * Normalise both sources into the one shape a desk understands.
   * `uid` is namespaced because a roster id and a browser id could collide.
   */
  collectWorkers() {
    const workers = [];

    for (const monitor of this.serverPayload?.monitors ?? []) {
      const normalised = { ...monitor, uid: `staff:${monitor.id}`, kind: 'staff' };
      workers.push(this.buildWorker(normalised));
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
      workers.push(this.buildWorker(normalised));
    }

    return workers;
  }

  buildWorker(monitor) {
    return makeWorker(monitor, deriveMood(monitor), dogOverrides.get(monitor.uid), {
      arriving: this.arriving.has(monitor.uid),
    });
  }

  render() {
    this.workers = this.collectWorkers();
    const summary = officeSummary(this.workers);

    this.room.dataset.worst = summary.worst;
    this.board.innerHTML = this.renderBoard(summary);

    this.floor.innerHTML = this.workers.length === 0
      ? `<div class="office-empty">${t('office.emptyHtml')}</div>`
      : `<div class="office-floor">${this.workers.map(renderDogWorkerCard).join('')}</div>`;

    // The arrival animation plays once; after this render it is history.
    for (const worker of this.workers) this.seen.add(worker.monitor.uid);
    this.arriving.clear();

    // Keep an open report in step with the poll it did not ask for.
    const open = this.report.worker;
    if (open) {
      const fresh = this.workers.find((worker) => worker.monitor.uid === open.monitor.uid);
      if (fresh) this.report.update(fresh);
      else this.report.close();
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
