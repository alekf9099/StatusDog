/**
 * Your own monitors, kept on your account — shared by the office and the dashboard.
 *
 * The server side is /api/auth/monitors (see src/store/members.ts). This module
 * asks who is signed in, loads and changes your list, and announces every fresh
 * copy with a `statusdog:mine` event, so the site-wide warning (watch.js) and the
 * other view on the page never have to ask again: every read costs storage.
 */
import { t } from './i18n.js';
import { store } from './statusdog.js';
import { dogOverrides } from './office/overrides.js';
import { resolveDog } from './office/dogs.js';

/** Your list only changes when you change it or a check runs, minutes apart. */
export const MINE_POLL_MS = 5 * 60_000;

let viewerPromise = null;

/** Who is signed in. Asked once per page; it does not change between polls. */
export function fetchViewer() {
  viewerPromise ??= fetch('/api/auth/me', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((viewer) => viewer ?? { configured: false, signedIn: false, owner: false });
  return viewerPromise;
}

function announce(payload) {
  document.dispatchEvent(new CustomEvent('statusdog:mine', { detail: payload }));
  return payload;
}

/** Your list, or `null` if it could not be read. */
export async function loadMine() {
  try {
    const response = await fetch('/api/auth/monitors', { cache: 'no-store' });
    if (!response.ok) return null;
    return announce(await response.json());
  } catch {
    return null;
  }
}

/**
 * Change your list: `{ op: 'add', url, type, expect, name }`, `{ op: 'remove', id }`
 * or `{ op: 'import', items }`. Resolves to the new list; rejects with an Error
 * carrying the server's `code` (member-limit, total-limit, duplicate, ...).
 */
export async function changeMine(body) {
  const response = await fetch('/api/auth/monitors', {
    method: 'POST',
    // The custom header every write here carries; the server refuses writes without it.
    headers: { 'content-type': 'application/json', 'x-statusdog-admin': '1' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error ?? t('error.requestFailed', { status: response.status }));
    error.code = payload.code ?? null;
    throw error;
  }
  return announce(payload);
}

/** A failed change, in words. `mine` is the last list seen, for its limits. */
export function mineErrorText(err, mine) {
  if (err.code === 'member-limit') return t('office.mine.limit', { n: mine?.limit ?? 5 });
  if (err.code === 'total-limit') return t('office.mine.full', { n: mine?.totalLimit ?? 50 });
  if (err.code === 'duplicate') return t('office.hire.duplicate');
  return t('office.mine.failed', { message: err.message });
}

/**
 * Move the monitors kept in this browser onto your account, as far as its limit
 * allows. Each keeps its name and its colleague's look: a look that was never
 * rolled comes from the old id's hash, so it is pinned before the id changes.
 * Resolves to `{ payload, moved, left }`, or `null` when there was nothing to move.
 */
export async function moveBrowserMonitors() {
  const local = store.list();
  if (local.length === 0) return null;
  const payload = await changeMine({
    op: 'import',
    items: local.map((monitor) => ({
      url: monitor.url,
      type: monitor.type ?? 'web',
      expect: monitor.expect,
      name: dogOverrides.get(`intern:${monitor.id}`)?.name,
    })),
  });
  let moved = 0;
  payload.results.forEach((result, i) => {
    const monitor = local[i];
    if (!result.ok || !monitor) return;
    const look = dogOverrides.get(`intern:${monitor.id}`) ?? {};
    const dog = resolveDog(monitor.id, look);
    dogOverrides.patch(`mine:${result.id}`, {
      dog: dog.key,
      coat: dog.coat.key,
      accessory: dog.accessory,
      species: dog.species.key,
      ...look,
    });
    dogOverrides.forget(`intern:${monitor.id}`);
    store.remove(monitor.id);
    moved++;
  });
  return { payload, moved, left: local.length - moved };
}

/** The words for a finished move of this browser's monitors onto the account. */
export function importMessage(moved, left, limit) {
  return left > 0
    ? `${t('office.mine.imported', { count: moved })} ${t('office.mine.importLeft', { count: left, n: limit })}`
    : t('office.mine.imported', { count: moved });
}
