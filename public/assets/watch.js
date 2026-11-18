/**
 * The watch — a warning on every page when a monitored site is in trouble, and
 * the parts that make StatusDog an app you can put on a phone's home screen.
 *
 * What it warns about, worst first:
 *   down       the site is confirmed down
 *   failing    a check failed (a connection error) and it is being re-checked
 *   slow       the site answers, but far slower than it usually does
 *   offline    this device has no connection, so what is shown may be old
 *   unreachable  StatusDog itself could not be reached
 *
 * It reads the same roster the office does, through mood.js, so the banner and
 * the office never disagree. Pages that already fetch the roster announce it
 * with a `statusdog:monitors` event and the watch reuses that, rather than
 * adding another request — every read costs storage quota.
 *
 * It warns while the app or a tab is open — a banner, a short vibration on a
 * phone, a badge on the installed app's icon. Alerts for when nothing is open
 * stay with the webhooks (Slack, Discord, Google Chat), whose own apps deliver
 * them to a phone.
 */
import { t } from './i18n.js';
import { TROUBLE_LEVELS as LEVELS, troubleOf as problemsOf, troubleSignature as signatureOf } from './office/mood.js';
import { escapeHtml } from './statusdog.js';

const POLL_MS = 120_000;
/** A roster another part of the page fetched this recently is good enough. */
const FRESH_MS = 90_000;
const DISMISSED_KEY = 'statusdog.watch.dismissed';
const NOTIFIED_KEY = 'statusdog.watch.notified';


let monitors = null;
let receivedAt = 0;
/** A signed-in person's own monitors, which matter to them as much as the roster. */
let mine = [];
let mineAt = 0;
let signedIn = null;
/** Your own list changes only when a check runs; asking for it costs storage reads. */
const MINE_FRESH_MS = 10 * 60_000;

document.addEventListener('statusdog:mine', (event) => {
  if (!Array.isArray(event.detail?.monitors)) return;
  mine = event.detail.monitors;
  mineAt = Date.now();
  render();
});

async function pollMine() {
  if (signedIn === null) {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      signedIn = response.ok ? Boolean((await response.json()).signedIn) : false;
    } catch {
      signedIn = false;
    }
  }
  if (!signedIn || Date.now() - mineAt < MINE_FRESH_MS) return;
  try {
    const response = await fetch('/api/auth/monitors', { cache: 'no-store' });
    if (!response.ok) return;
    mine = (await response.json()).monitors ?? [];
    mineAt = Date.now();
  } catch {
    // Keep what we had.
  }
}
let unreachable = false;
let banner = null;

/* ---------- reading the roster ---------- */

document.addEventListener('statusdog:monitors', (event) => {
  if (!Array.isArray(event.detail?.monitors)) return;
  monitors = event.detail.monitors;
  receivedAt = Date.now();
  unreachable = false;
  render();
});

async function poll({ force = false } = {}) {
  if (document.hidden) return;
  await pollMine();
  if (!force && Date.now() - receivedAt < FRESH_MS) return;
  if (!navigator.onLine) {
    render();
    return;
  }
  try {
    // The same URL as the home page's office, so the two share one cached answer.
    const response = await fetch('/api/monitors?history=12');
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    monitors = payload.monitors ?? [];
    receivedAt = Date.now();
    unreachable = false;
  } catch {
    unreachable = true;
  }
  render();
}

/* ---------- the banner ---------- */

function names(list) {
  const shown = list.slice(0, 2).map((site) => site.name).join(', ');
  return list.length > 2 ? `${shown} ${t('watch.others', { count: list.length - 2 })}` : shown;
}

function storage(kind) {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function render() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const problems = problemsOf([...(monitors ?? []), ...mine]);
  const worst = LEVELS.find((level) => problems[level].length > 0) ?? null;
  const offline = !navigator.onLine;
  const count = LEVELS.reduce((sum, level) => sum + problems[level].length, 0);

  // The installed app's icon carries the count, where the platform supports it.
  if (count > 0) navigator.setAppBadge?.(count).catch(() => {});
  else navigator.clearAppBadge?.().catch(() => {});

  const lines = LEVELS
    .filter((level) => problems[level].length > 0)
    .map((level) => `<span class="watch-part" data-level="${level}"><strong>${escapeHtml(t(`watch.${level}`))}</strong> ${escapeHtml(names(problems[level]))}</span>`);
  if (offline) lines.push(`<span class="watch-part" data-level="offline">${escapeHtml(t('watch.offline'))}</span>`);
  else if (unreachable) lines.push(`<span class="watch-part" data-level="offline">${escapeHtml(t('watch.unreachable'))}</span>`);

  const signature = `${signatureOf(problems)}|${offline ? 'offline' : unreachable ? 'unreachable' : ''}`;
  const dismissed = storage('session')?.getItem(DISMISSED_KEY) === signature;

  if (lines.length === 0 || dismissed) {
    banner?.remove();
    banner = null;
    return;
  }

  const all = LEVELS.flatMap((level) => problems[level]);
  const href = all.length === 1 ? `/status/${encodeURIComponent(all[0].id)}` : '/status';
  const level = worst ?? 'offline';

  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'watch-banner';
    banner.setAttribute('role', 'alert');
    banner.addEventListener('click', (event) => {
      if (!event.target.closest('[data-watch-dismiss]')) return;
      storage('session')?.setItem(DISMISSED_KEY, banner.dataset.signature);
      banner.remove();
      banner = null;
    });
    header.append(banner);
  }
  banner.dataset.level = level;
  banner.dataset.signature = signature;
  banner.innerHTML = `
    <div class="wrap watch-inner">
      <span class="watch-icon" aria-hidden="true"></span>
      <span class="watch-text">${lines.join('<span class="watch-sep" aria-hidden="true">·</span>')}</span>
      ${all.length > 0 ? `<a class="watch-more" href="${href}">${escapeHtml(t('watch.more'))}</a>` : ''}
      <button type="button" class="watch-dismiss" data-watch-dismiss aria-label="${escapeHtml(t('watch.dismiss'))}">×</button>
    </div>`;

  nudge(problems);
}

/**
 * A short buzz on a phone when something new goes wrong — once per problem,
 * not on every poll, and only for the sites, not for being offline.
 */
function nudge(problems) {
  const signature = signatureOf(problems);
  const empty = LEVELS.every((level) => problems[level].length === 0);
  const store = storage('session');
  if (empty || store?.getItem(NOTIFIED_KEY) === signature) return;
  store?.setItem(NOTIFIED_KEY, signature);
  try {
    navigator.vibrate?.(problems.down.length > 0 ? [220, 90, 220] : 160);
  } catch {
    // Vibration needs the page to have been touched first; without it, the banner is enough.
  }
}

/* ---------- installing ---------- */

let installPrompt = null;

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** An "Install app" button in the footer, when the browser can install, or on iOS with instructions. */
function renderInstall() {
  const footer = document.querySelector('.site-footer .wrap');
  if (!footer || isInstalled()) return;
  if (!installPrompt && !isIos()) return;

  let button = footer.querySelector('.install-app');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'install-app';
    button.addEventListener('click', async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => null);
        installPrompt = null;
        button.remove();
        return;
      }
      // iOS has no install prompt; say where the option is.
      let hint = footer.querySelector('.install-hint');
      if (hint) {
        hint.remove();
        return;
      }
      hint = document.createElement('p');
      hint.className = 'install-hint';
      hint.innerHTML = t('install.iosHtml');
      footer.append(hint);
    });
    footer.prepend(button);
  }
  button.textContent = t('install.button');
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelector('.install-app')?.remove();
});

/* ---------- start ---------- */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('online', () => void poll({ force: true }));
window.addEventListener('offline', render);
// Opening the app, or coming back to the tab, checks straight away.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void poll();
});
document.addEventListener('statusdog:languagechange', () => {
  render();
  renderInstall();
});

renderInstall();
// Give the page a moment to announce a roster it is already fetching.
setTimeout(() => void poll(), 2500);
setInterval(() => void poll(), POLL_MS);
