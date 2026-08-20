/**
 * ServerReportModal — the slide-over that opens when you click a dog.
 *
 * A dialog rather than a popup: focus moves in, Escape and the scrim close it,
 * and focus returns to the desk you clicked. A panel you cannot leave by keyboard
 * is not cute.
 *
 * Everything shown here is already on hand from `/api/monitors` — the stored
 * `lastResult` carries TLS and headers — so opening a report costs no request.
 * "Check again" runs a live probe on demand.
 *
 * It is also where a dog gets renamed or re-rolled. Those belong on the report
 * rather than on the desk: the floor should read at a glance, and an edit control
 * on every desk would compete with the status for attention.
 */
import { check, escapeHtml, formatMs, formatRelative, prettyUrl, sparkline } from '../statusdog.js';
import { t, getLanguage } from '../i18n.js';
import { renderDogChip } from './DogWorkerCard.js';
import { deriveMood } from './mood.js';
import { MAX_DOG_NAME_LENGTH } from './dogs.js';

export class ServerReportModal {
  /**
   * @param {{ onRename?: Function, onReroll?: Function, onDismiss?: Function }} hooks
   *   Supplied by the office, which owns the override store and the redraw.
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.worker = null;
    this.returnFocusTo = null;
    this.liveResult = null;
    this.busy = false;
    this.editingName = false;

    this.scrim = document.createElement('div');
    this.scrim.className = 'report-scrim';
    this.scrim.hidden = true;

    this.panel = document.createElement('aside');
    this.panel.className = 'report-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.hidden = true;

    document.body.append(this.scrim, this.panel);

    this.scrim.addEventListener('click', () => this.close());
    this.panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-report-close]')) this.close();
      if (event.target.closest('[data-report-recheck]')) void this.recheck();
      if (event.target.closest('[data-report-edit]')) this.startEditing();
      if (event.target.closest('[data-report-cancel-edit]')) this.stopEditing();
      if (event.target.closest('[data-report-reroll]')) this.reroll();
      if (event.target.closest('[data-report-dismiss]')) this.dismiss();
    });

    this.panel.addEventListener('submit', (event) => {
      if (!event.target.closest('[data-rename-form]')) return;
      event.preventDefault();
      this.commitName();
    });

    // Escape inside the name field should abandon the edit, not close the panel.
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.editingName) {
        event.stopPropagation();
        this.stopEditing();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
    });
    document.addEventListener('statusdog:languagechange', () => {
      if (this.isOpen) this.render();
    });
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  open(worker, returnFocusTo = null) {
    this.worker = worker;
    this.returnFocusTo = returnFocusTo;
    this.liveResult = null;
    this.busy = false;
    this.editingName = false;

    this.scrim.hidden = false;
    this.panel.hidden = false;
    this.render();

    // Let the browser paint the hidden state before transitioning in.
    requestAnimationFrame(() => {
      this.scrim.dataset.open = 'true';
      this.panel.dataset.open = 'true';
      this.panel.querySelector('[data-report-close]')?.focus();
    });
  }

  /** Refresh in place when new poll data arrives, without disturbing the reader. */
  update(worker) {
    if (!this.isOpen || !this.worker) return;
    if (worker.monitor.uid !== this.worker.monitor.uid) return;
    this.worker = worker;
    // A poll must not yank the field out from under someone mid-rename.
    if (this.editingName) return;
    this.render();
  }

  /* ---------------- naming ---------------- */

  startEditing() {
    this.editingName = true;
    this.render();
    const field = this.panel.querySelector('[data-rename-input]');
    if (field) {
      field.focus();
      field.select();
    }
  }

  stopEditing() {
    this.editingName = false;
    this.render();
    this.panel.querySelector('[data-report-edit]')?.focus();
  }

  commitName() {
    const field = this.panel.querySelector('[data-rename-input]');
    if (!field || !this.worker) return;
    const value = field.value;

    // Leave edit mode *before* the hook fires. The hook triggers the office to
    // re-render, and `update` deliberately skips a re-render while editing so a
    // poll cannot yank the field away — which would otherwise strand the panel on
    // the form after a save.
    this.editingName = false;
    // An empty field clears the override and restores the rolled name.
    this.hooks.onRename?.(this.worker.monitor.uid, value);
  }

  reroll() {
    if (!this.worker) return;
    this.editingName = false;
    this.hooks.onReroll?.(this.worker.monitor.uid);
  }

  dismiss() {
    if (!this.worker) return;
    const uid = this.worker.monitor.uid;
    this.close();
    this.hooks.onDismiss?.(uid);
  }

  close() {
    if (!this.isOpen) return;
    delete this.scrim.dataset.open;
    delete this.panel.dataset.open;

    const restore = this.returnFocusTo;
    // Wait out the slide-out before hiding, so the transition is visible.
    setTimeout(() => {
      this.scrim.hidden = true;
      this.panel.hidden = true;
      this.worker = null;
      this.liveResult = null;
    }, 260);

    if (restore && document.contains(restore)) restore.focus();
    else document.querySelector('.desk')?.focus();
  }

  async recheck() {
    if (!this.worker || this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.liveResult = await check(this.worker.monitor.url);
    } catch (err) {
      this.liveResult = { error: err.message };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  render() {
    if (!this.worker) return;
    const { monitor, mood, dog } = this.worker;
    const name = dog.names[getLanguage()] ?? dog.names.en;

    this.panel.setAttribute('aria-label', t('office.report.title', { dog: name, site: monitor.name }));
    this.panel.style.setProperty('--mood-color', `var(--mood-${moodToken(mood.mood)})`);

    this.panel.innerHTML = `
      <header class="report-head">
        ${renderDogChip(this.worker)}
        <div class="report-title">
          ${this.nameRow(name)}
          <div class="report-sub">
            <a href="/check?url=${encodeURIComponent(monitor.url)}">${escapeHtml(prettyUrl(monitor.url))}</a>
          </div>
        </div>
        <button type="button" class="report-close" data-report-close
                aria-label="${escapeHtml(t('office.report.close'))}">×</button>
      </header>
      <div class="report-body" data-mood="${escapeHtml(mood.mood)}">
        ${this.quote()}
        ${this.metrics()}
        ${this.diagnosis()}
        ${this.history()}
        ${this.tls()}
        ${this.headers()}
        ${this.live()}
        ${this.actions()}
      </div>`;
  }

  /** The heading doubles as the rename control. */
  nameRow(name) {
    if (this.editingName) {
      return `
        <form class="rename-form" data-rename-form>
          <input type="text" data-rename-input maxlength="${MAX_DOG_NAME_LENGTH}"
                 value="${escapeHtml(this.worker.dog.custom ? name : '')}"
                 placeholder="${escapeHtml(name)}"
                 aria-label="${escapeHtml(t('office.rename.label'))}">
          <button type="submit">${escapeHtml(t('office.rename.save'))}</button>
          <button type="button" class="secondary" data-report-cancel-edit>${escapeHtml(t('office.rename.cancel'))}</button>
          <p class="rename-hint">${escapeHtml(t('office.rename.hint'))}</p>
        </form>`;
    }

    return `
      <div class="report-name">
        <h2>${escapeHtml(t('office.report.heading', { dog: name }))}</h2>
        <button type="button" class="report-edit" data-report-edit
                aria-label="${escapeHtml(t('office.rename.label'))}">${escapeHtml(t('office.rename.edit'))}</button>
      </div>`;
  }

  quote() {
    const { mood, dog } = this.worker;
    const name = dog.names[getLanguage()] ?? dog.names.en;
    return `<p class="report-quote">${escapeHtml(t(`office.mood.${mood.mood}.line`, { dog: name }))}</p>`;
  }

  metrics() {
    const { monitor, mood } = this.worker;
    const result = monitor.lastResult;
    const stats = monitor.stats;
    const uptime = stats && stats.uptimePct !== null && stats.uptimePct !== undefined
      ? `${stats.uptimePct}%`
      : '–';

    return `
      <h3>${escapeHtml(t('office.report.now'))}</h3>
      <div class="metrics">
        <div class="metric"><span class="label">${escapeHtml(t('metric.status'))}</span><span class="value">${result?.status ?? '–'}</span></div>
        <div class="metric"><span class="label">${escapeHtml(t('metric.response'))}</span><span class="value">${formatMs(mood.lastMs)}</span></div>
        <div class="metric"><span class="label">${escapeHtml(t('metric.uptime'))}</span><span class="value">${uptime}</span></div>
        <div class="metric"><span class="label">${escapeHtml(t('metric.checked'))}</span><span class="value" style="font-size:15px">${escapeHtml(formatRelative(result?.checkedAt))}</span></div>
      </div>`;
  }

  /**
   * Why the dog looks the way it does. This is the part a plain status table
   * cannot give you: the number compared against what is normal *for this site*.
   */
  diagnosis() {
    const { monitor, mood } = this.worker;
    const rows = [];

    if (mood.baselineMs !== null) {
      rows.push([t('office.report.baseline'), formatMs(mood.baselineMs)]);
    }
    if (mood.ratio !== null) {
      rows.push([t('office.report.ratio'), `${mood.ratio}×`]);
    }
    if (mood.limitMs > 0) {
      rows.push([t('office.report.limit'), formatMs(mood.limitMs)]);
    }
    if (Number(monitor.consecutiveFailures) > 0) {
      rows.push([t('office.report.consecutiveFailures'), String(monitor.consecutiveFailures)]);
    }
    if (monitor.since) {
      rows.push([
        t('office.report.since'),
        t('dash.since', { state: t(`state.${monitor.state}`), time: formatRelative(monitor.since) }),
      ]);
    }
    const message = monitor.lastResult && !monitor.lastResult.ok ? monitor.lastResult.message : null;
    if (message) rows.push([t('office.report.lastError'), message]);

    // The dog is calm because nothing was concluded, not because nothing happened.
    const dispute = monitor.lastDispute;
    if (dispute && (!monitor.lastResult || dispute.at > monitor.lastResult.checkedAt)) {
      rows.push([t('office.report.disputed'), t('office.report.disputedV', { time: formatRelative(dispute.at) })]);
    }

    if (rows.length === 0) return '';

    return `
      <h3>${escapeHtml(t('office.report.diagnosis'))}</h3>
      <div class="scroll-x"><table class="kv">${rows
        .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
        .join('')}</table></div>`;
  }

  history() {
    const history = this.worker.monitor.history ?? [];
    if (history.length === 0) return '';
    return `
      <h3>${escapeHtml(t('office.report.recent', { count: history.length }))}</h3>
      ${sparkline(history)}`;
  }

  tls() {
    const cert = this.worker.monitor.lastResult?.detail?.tls;
    if (!cert) return '';
    const days = cert.daysRemaining;
    const expiry = days === null
      ? escapeHtml(cert.validTo ?? '–')
      : `${escapeHtml(t('value.days', { n: days }))} <span class="muted">(${escapeHtml(cert.validTo ?? '')})</span>`;

    return `
      <h3>${escapeHtml(t('check.tls.h2'))}</h3>
      <div class="scroll-x"><table class="kv">
        <tr><th>${escapeHtml(t('check.tls.subject'))}</th><td>${escapeHtml(cert.subject ?? '–')}</td></tr>
        <tr><th>${escapeHtml(t('check.tls.issuer'))}</th><td>${escapeHtml(cert.issuer ?? '–')}</td></tr>
        <tr><th>${escapeHtml(t('check.tls.validTo'))}</th><td>${expiry}</td></tr>
        <tr><th>${escapeHtml(t('check.tls.protocol'))}</th><td>${escapeHtml(cert.protocol ?? '–')}</td></tr>
      </table></div>`;
  }

  headers() {
    const entries = Object.entries(this.worker.monitor.lastResult?.detail?.headers ?? {});
    if (entries.length === 0) return '';
    return `
      <h3>${escapeHtml(t('check.headers.h2'))}</h3>
      <div class="scroll-x"><table class="kv">${entries
        .map(([name, value]) => `<tr><th>${escapeHtml(name)}</th><td>${escapeHtml(value)}</td></tr>`)
        .join('')}</table></div>`;
  }

  live() {
    if (this.busy) {
      return `<h3>${escapeHtml(t('office.report.liveHeading'))}</h3>
        <p class="small muted" style="margin:0">${escapeHtml(t('office.report.checking'))}</p>`;
    }
    if (!this.liveResult) return '';
    if (this.liveResult.error) {
      return `<h3>${escapeHtml(t('office.report.liveHeading'))}</h3>
        <div class="notice error small">${escapeHtml(this.liveResult.error)}</div>`;
    }

    const live = this.liveResult;
    const liveMood = deriveMood({
      state: live.ok ? 'up' : 'down',
      consecutiveFailures: 0,
      maxResponseTimeMs: this.worker.monitor.maxResponseTimeMs,
      lastResult: live,
      history: this.worker.monitor.history ?? [],
    });

    return `
      <h3>${escapeHtml(t('office.report.liveHeading'))}</h3>
      <div class="metrics" data-mood="${escapeHtml(liveMood.mood)}">
        <div class="metric"><span class="label">${escapeHtml(t('metric.status'))}</span><span class="value">${live.status ?? '–'}</span></div>
        <div class="metric"><span class="label">${escapeHtml(t('metric.response'))}</span><span class="value">${formatMs(live.responseTimeMs)}</span></div>
        <div class="metric"><span class="label">${escapeHtml(t('metric.redirects'))}</span><span class="value">${live.redirects}</span></div>
      </div>
      ${live.ok ? '' : `<div class="notice error small" style="margin-top:12px">${escapeHtml(live.message ?? t('error.checkFailed'))}</div>`}`;
  }

  actions() {
    const { monitor } = this.worker;
    // Only interns can be dismissed here: roster targets live in monitors.json,
    // and a button that silently failed to remove one would be a lie.
    const dismiss = monitor.kind === 'intern'
      ? `<button type="button" class="secondary report-danger" data-report-dismiss>${escapeHtml(t('office.dismiss'))}</button>`
      : '';

    return `
      <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="secondary" data-report-recheck ${this.busy ? 'disabled' : ''}>
          ${escapeHtml(this.busy ? t('office.report.checking') : t('office.report.recheck'))}
        </button>
        <a href="/check?url=${encodeURIComponent(monitor.url)}"><button type="button" class="secondary">${escapeHtml(t('home.fullReport'))}</button></a>
      </div>
      <div class="report-actions-secondary">
        <button type="button" class="secondary" data-report-reroll>${escapeHtml(t('office.reroll'))}</button>
        ${dismiss}
      </div>
      ${monitor.kind === 'staff' ? `<p class="rename-hint" style="margin-top:12px">${escapeHtml(t('office.staffNote'))}</p>` : ''}`;
  }
}

/** CSS custom properties use lowercase tokens; the mood names are camelCase. */
function moodToken(mood) {
  return mood === 'offDuty' ? 'offduty' : mood;
}
