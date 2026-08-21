/**
 * The account control in the site header.
 *
 * Self-mounting: every page includes this file and it finds its own place in the
 * nav, because the sign-in state belongs on all six pages rather than buried in one
 * section of one of them. The first version put it under the subscribe box on a
 * single status page, which meant somebody who had signed in could not find how to
 * sign out — the bug that prompted this file.
 *
 * Hidden entirely when the deployment has no admin surface configured. A reader who
 * will never be an owner should not be shown a door they cannot open, and offering a
 * sign-in that returns 503 is worse than offering none.
 */
import { getLanguage, initI18n, t } from '/assets/i18n.js';
import { escapeHtml } from '/assets/statusdog.js';

/** Asked once per page load: this does not change between polls. */
let viewer = null;

async function fetchViewer() {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) return { configured: false, signedIn: false, email: null };
    return await response.json();
  } catch {
    // A failure here means no control, never a broken page.
    return { configured: false, signedIn: false, email: null };
  }
}

/**
 * Where to come back to after signing in.
 *
 * The current page, minus any `signin=` marker so a second attempt does not stack
 * them up. `safeNextPath` on the server refuses anything that could leave the site.
 */
function returnPath() {
  const search = location.search.replace(/[?&]signin=[^&]*/g, '').replace(/^&/, '?');
  return `${location.pathname}${search}`;
}

function render(mount) {
  if (!viewer?.configured) {
    mount.innerHTML = '';
    return;
  }

  if (!viewer.signedIn) {
    mount.innerHTML = `
      <a class="account-link" href="/signin?next=${encodeURIComponent(returnPath())}"
         title="${escapeHtml(t('signin.in'))}">${escapeHtml(t('signin.in'))}</a>`;
    return;
  }

  // The address is shown as a title rather than inline: it is the owner's own
  // email, it is long, and the header is not the place for it.
  const email = viewer.email ?? '';
  mount.innerHTML = `
    <span class="account-chip" title="${escapeHtml(email)}">
      <span class="account-dot" aria-hidden="true"></span>
      <span class="account-name">${escapeHtml(email.split('@')[0] ?? '')}</span>
      <button type="button" data-account-signout>${escapeHtml(t('signin.out'))}</button>
    </span>`;
}

async function signOut(mount) {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      // Same custom header every write uses; the server checks it before the session.
      headers: { 'x-statusdog-admin': '1' },
    });
  } catch {
    // Even a failed call should not leave a stale-looking header.
  }
  viewer = await fetchViewer();
  render(mount);
  // Anything on the page that was showing owner controls needs to know.
  document.dispatchEvent(new CustomEvent('statusdog:accountchange', { detail: viewer }));
}

async function mount() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  // Before the language switch, so the control reads left-to-right as
  // "…docs, GitHub, account | EN 한국어".
  const slot = document.createElement('span');
  slot.className = 'account-slot';
  const langSwitch = nav.querySelector('.lang-switch');
  if (langSwitch) nav.insertBefore(slot, langSwitch);
  else nav.appendChild(slot);

  viewer = await fetchViewer();
  render(slot);

  slot.addEventListener('click', (event) => {
    if (event.target.closest('[data-account-signout]')) signOut(slot);
  });
  document.addEventListener('statusdog:languagechange', () => render(slot));
}

// The pages that already run i18n themselves call it first; calling it twice is
// harmless, and this file has to work on any page that includes it.
initI18n();
if (getLanguage()) mount();
