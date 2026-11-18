/**
 * OfficeDashboard — the floor, and who is on it.
 *
 * Pulls from every half of StatusDog and gives each a different job title,
 * because the difference is real rather than cosmetic:
 *
 *   mine   — monitors a signed-in person keeps on their account. Saved on the
 *            server, the same on every device, checked with the roster.
 *
 *   staff  — targets on the server roster, checked every 15 minutes whether or
 *            not anyone is looking. Their history survives a closed tab.
 *   intern — monitors you added in this browser. They only work while the tab is
 *            open, and their notes are gone when localStorage is cleared.
 *
 * Two views of the same people: the pixel room on a canvas, where they walk
 * about and act out their moods, and the roster under it as buttons. The roster
 * is re-rendered whole per poll; the room keeps its colleagues and only tells them
 * how they feel now, so nobody snaps back to their desk mid-stride. The open
 * report is updated in place, so it does not shut under the reader.
 */
import { check, escapeHtml, reflectStateInTab, renderStaleBanner, store } from '../statusdog.js';
import { tenureOf } from './tenure.js';
import { getLanguage, t } from '../i18n.js';
import { deriveMood, officeSummary } from './mood.js';
import { makeWorker, renderDogWorkerCard } from './DogWorkerCard.js';
import { ServerReportModal } from './ServerReportModal.js';
import { dogOverrides } from './overrides.js';
import { randomDogAssignment } from './dogs.js';
import { normalizeUrlForDisplay } from './url.js';
import { PixelOffice } from './pixel/PixelOffice.js';
import { changeMine, fetchViewer, importMessage, loadMine, MINE_POLL_MS, mineErrorText, moveBrowserMonitors } from '../mine.js';
import { expectFor, typeSwitch } from '../target-type.js';

const POLL_MS = 60_000;

export class OfficeDashboard {
  /**
   * @param {{ room: HTMLElement, floor: HTMLElement, board: HTMLElement }} elements
   */
  constructor({ room, floor, canvas, board, hireForm, hireUrl, hireName, hireSubmit, hireError, staleBanner }) {
    this.room = room;
    this.floor = floor;
    this.board = board;
    this.staleBanner = staleBanner ?? null;
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
      onDismiss: async (uid) => {
        if (uid.startsWith('mine:')) {
          try {
            this.setMine(await changeMine({ op: 'remove', id: uid.slice('mine:'.length) }));
          } catch {
            return;
          }
        }
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
    /** Who is signed in (from /api/auth/me), and their own list once loaded. */
    this.viewer = null;
    this.mine = null;
    this.mineAt = 0;

    this.pixel = canvas
      ? new PixelOffice(canvas, {
        onSelect: (uid) => {
          const worker = this.workers.find((candidate) => candidate.monitor.uid === uid);
          // Focus comes back to the colleague's card when the report closes.
          const card = this.floor.querySelector(`[data-worker-id="${CSS.escape(uid)}"]`);
          if (worker) this.report.open(worker, card);
        },
      })
      : null;

    this.floor.addEventListener('click', (event) => {
      const desk = event.target.closest('.desk');
      if (!desk) return;
      const worker = this.workers.find((candidate) => candidate.monitor.uid === desk.dataset.workerId);
      if (worker) this.report.open(worker, desk);
    });

    document.addEventListener('statusdog:languagechange', () => {
      this.renderHireNote();
      this.render();
    });

    this.hire.kind = this.hire.form
      ? typeSwitch(this.hire.form, this.hire.url, { fieldAfter: this.hire.url.closest('label') })
      : null;

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

    // Signed in: the colleague goes on your account, not into this browser.
    if (this.viewer?.signedIn) {
      try {
        const before = new Set((this.mine?.monitors ?? []).map((monitor) => monitor.id));
        const payload = await changeMine({
          op: 'add',
          url: display,
          type: this.hire.kind?.type,
          expect: this.hire.kind?.expect,
          name: name.value.trim() || undefined,
        });
        this.setMine(payload);
        const added = payload.monitors.find((monitor) => !before.has(monitor.id));
        if (added) {
          const uid = `mine:${added.id}`;
          dogOverrides.patch(uid, {
            ...randomDogAssignment(),
            ...(name.value.trim() === '' ? {} : { name: name.value }),
          });
          this.arriving.add(uid);
        }
        url.value = '';
        name.value = '';
        this.render();
      } catch (err) {
        this.showHireError(this.mineErrorText(err));
      } finally {
        submit.disabled = false;
        submit.textContent = t('office.hire.submit');
      }
      return;
    }

    try {
      const { monitor, added } = store.add(display, {
        type: this.hire.kind?.type,
        expect: this.hire.kind?.expect,
      });
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

  /** A server error about your own list, in words. */
  mineErrorText(err) {
    return mineErrorText(err, this.mine);
  }

  /** A fresh copy of your list (mine.js has already announced it to the page). */
  setMine(payload) {
    this.mine = payload;
    this.mineAt = Date.now();
  }

  async loadViewer() {
    if (this.viewer) return;
    this.viewer = await fetchViewer();
    this.renderHireNote();
  }

  async loadMine({ force = false } = {}) {
    if (!this.viewer?.signedIn) return;
    if (!force && Date.now() - this.mineAt < MINE_POLL_MS) return;
    // On failure your colleagues stay as they were until the next try.
    const payload = await loadMine();
    if (payload) this.setMine(payload);
  }

  /**
   * Under the hire form: what hiring does for you now, and — once you are signed
   * in with interns still in this browser — a button to move them to your account.
   */
  renderHireNote() {
    const { form } = this.hire;
    if (!form) return;
    let box = form.querySelector('.hire-mine');
    if (!box) {
      box = document.createElement('div');
      box.className = 'hire-mine';
      form.append(box);
      box.addEventListener('click', (event) => {
        if (event.target.closest('[data-import-interns]')) void this.importInterns();
      });
    }
    const viewer = this.viewer;
    const internNote = form.querySelector('.hire-note[data-i18n]');
    if (internNote) internNote.hidden = Boolean(viewer?.signedIn);
    if (!viewer?.configured) {
      box.innerHTML = '';
      return;
    }
    if (!viewer.signedIn) {
      box.innerHTML = `<p class="hire-note">${escapeHtml(t('office.mine.signinHint'))}
        <a href="/signin?next=${encodeURIComponent('/office')}">${escapeHtml(t('signin.in'))}</a></p>`;
      return;
    }
    const interns = store.list().length;
    box.innerHTML = `
      <p class="hire-note">${escapeHtml(t('office.mine.note', { n: this.mine?.limit ?? 5 }))}</p>
      ${interns > 0 ? `<button type="button" class="secondary hire-import" data-import-interns>${escapeHtml(t('office.mine.import', { count: interns }))}</button>` : ''}
      <p class="hire-message" hidden></p>`;
  }

  /** Move this browser's interns onto your account, keeping their names and looks. */
  async importInterns() {
    const box = this.hire.form?.querySelector('.hire-mine');
    const button = box?.querySelector('[data-import-interns]');
    if (button) button.disabled = true;
    try {
      const outcome = await moveBrowserMonitors();
      if (!outcome) return;
      this.setMine(outcome.payload);
      this.renderHireNote();
      const message = this.hire.form?.querySelector('.hire-message');
      if (message) {
        message.textContent = importMessage(outcome.moved, outcome.left, outcome.payload.limit);
        message.hidden = false;
      }
      this.render();
    } catch (err) {
      this.showHireError(this.mineErrorText(err));
      if (button) button.disabled = false;
    }
  }

  start() {
    this.pixel?.start();
    void this.refresh();
    setInterval(() => void this.refresh(), POLL_MS);
  }

  /** Fetch roster state, run the browser monitors, then redraw. */
  async refresh() {
    await this.loadViewer();
    await Promise.all([this.loadStaff(), this.loadRecords(), this.runInterns(), this.loadMine()]);
    this.render();
  }

  /**
   * Tenure and clean-run figures, fetched once rather than on every poll.
   *
   * A streak measured in days does not change between two one-minute polls, and
   * this payload carries months of daily buckets. Failing is fine: the desks lose
   * a line and nothing else.
   */
  async loadRecords() {
    if (this.records !== undefined) return;
    this.records = null;
    try {
      const response = await fetch('/api/stats?days=400', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      this.records = new Map((payload.targets ?? []).map((target) => [target.id, target]));
    } catch {
      this.records = null;
    }
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
      // The site-wide warning (watch.js) reads this instead of asking again.
      document.dispatchEvent(new CustomEvent('statusdog:monitors', { detail: payload }));
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
      store.record(monitor.id, await check(monitor.url, { expect: expectFor(monitor) }));
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
      const normalised = {
        ...monitor,
        uid: `staff:${monitor.id}`,
        kind: 'staff',
        // Roster dogs have a record; interns have only this tab.
        tenure: tenureOf(monitor, this.records?.get(monitor.id) ?? null),
      };
      workers.push(this.buildWorker(normalised));
    }

    // Your own monitors, from your account.
    for (const monitor of this.mine?.monitors ?? []) {
      const normalised = {
        ...monitor,
        uid: `mine:${monitor.id}`,
        kind: 'mine',
        name: monitor.name ?? monitor.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        maxResponseTimeMs: 0,
        stats: statsFromHistory(monitor.history ?? []),
        tenure: null,
      };
      workers.push(this.buildWorker(normalised));
    }

    for (const monitor of store.list()) {
      const normalised = {
        id: monitor.id,
        uid: `intern:${monitor.id}`,
        kind: 'intern',
        type: monitor.type ?? 'web',
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
    renderStaleBanner(this.staleBanner, this.serverPayload?.scheduler ?? null);
    reflectStateInTab(this.serverPayload?.monitors ?? []);

    this.floor.innerHTML = this.workers.length === 0
      ? `<div class="office-empty">${t('office.emptyHtml')}</div>`
      : `<div class="office-roster">${this.workers.map(renderDogWorkerCard).join('')}</div>`;
    this.pixel?.setWorkers(this.workers.map((worker) => ({
      ...worker,
      label: worker.dog.names[getLanguage()] ?? worker.dog.names.en,
    })));

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

  /**
   * A line naming the interns, when there are any.
   *
   * Without it a browser-local monitor that cannot be reached reads as an outage of
   * something this deployment watches, which is exactly the wrong conclusion.
   */
  internNote(summary) {
    if (!summary.interns) return '';
    const text = summary.internsInTrouble > 0
      ? t('office.board.internTrouble', { count: summary.internsInTrouble })
      : t('office.board.internCount', { count: summary.interns });
    return `<p class="board-interns">${escapeHtml(text)}</p>`;
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
    return `<strong>${escapeHtml(headcount)}</strong> — ${escapeHtml(mood)}${this.internNote(summary)}`;
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
