/**
 * Website or app API — a switch for any form that takes a URL to check.
 *
 * StatusDog checks both the same way, from outside, over HTTPS. What differs is
 * what counts as healthy: a website may redirect, while an app's API usually
 * answers 2xx straight away — or 401 when called without a login, which still
 * means the server is up. So the API side asks which status codes are healthy,
 * and says what kind of address to give it.
 *
 * Pure helpers are exported for tests; `typeSwitch` wires a form up.
 */
import { t } from './i18n.js';

export const TARGET_TYPES = ['web', 'api'];
/** An API should answer directly; a redirect to a login page is not a healthy API. */
export const API_DEFAULT_EXPECT = '2xx';

/** `200`, `2xx` or `200-299`, comma-separated, as /api/check accepts them. */
const STATUS_PART = /^(?:[1-5]\d\d|[1-5]xx|[1-5]\d\d-[1-5]\d\d)$/i;

/** Tidy a typed status list, or `null` if any part of it is not a status. */
export function normalizeExpect(value) {
  const parts = String(value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return API_DEFAULT_EXPECT;
  return parts.every((part) => STATUS_PART.test(part)) ? parts.join(',') : null;
}

/** The `expect` to check a stored monitor with: an API's own list, or the site default. */
export function expectFor(monitor) {
  return monitor?.type === 'api' ? monitor.expect ?? API_DEFAULT_EXPECT : undefined;
}

/**
 * Put a website / app API switch above `form`, an "expected status codes" field
 * after `input`, and a hint under the form. Returns `{ type, expect }` getters;
 * `expect` is undefined for a website, and the field refuses to submit nonsense.
 */
export function typeSwitch(form, input, { fieldAfter = input, inside = false } = {}) {
  let type = 'web';

  const bar = document.createElement('div');
  bar.className = 'type-switch';
  bar.setAttribute('role', 'group');
  bar.innerHTML = TARGET_TYPES
    .map((value) => `<button type="button" data-type="${value}" aria-pressed="${value === type}"></button>`)
    .join('');
  // Inside a form that is its own card; above a bare one-line form.
  if (inside) form.prepend(bar);
  else form.before(bar);

  const field = document.createElement('label');
  field.className = 'type-expect';
  field.hidden = true;
  field.innerHTML = '<span></span><input type="text" spellcheck="false" autocomplete="off" inputmode="text">';
  const expectInput = field.querySelector('input');
  expectInput.value = API_DEFAULT_EXPECT;
  fieldAfter.after(field);

  const hint = document.createElement('p');
  hint.className = 'type-hint';
  hint.hidden = true;
  if (inside) form.append(hint);
  else form.after(hint);

  const label = () => {
    bar.setAttribute('aria-label', t('type.switch'));
    for (const button of bar.querySelectorAll('button')) button.textContent = t(`type.${button.dataset.type}`);
    field.querySelector('span').textContent = t('type.expectLabel');
    hint.textContent = t('type.apiHint');
    // A website keeps the page's own placeholder; an API gets an example API address.
    const own = input.dataset.i18nPlaceholder;
    input.placeholder = type === 'api' ? t('type.apiPlaceholder') : t(own ?? 'type.webPlaceholder');
  };

  const set = (next) => {
    type = next;
    for (const button of bar.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.type === type));
    }
    field.hidden = type !== 'api';
    hint.hidden = type !== 'api';
    form.dataset.type = type;
    label();
  };

  bar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button) return;
    set(button.dataset.type);
    input.focus();
  });
  expectInput.addEventListener('input', () => {
    expectInput.setCustomValidity(normalizeExpect(expectInput.value) === null ? t('type.invalidExpect') : '');
  });
  document.addEventListener('statusdog:languagechange', label);
  set('web');

  return {
    get type() {
      return type;
    },
    get expect() {
      return type === 'api' ? normalizeExpect(expectInput.value) ?? API_DEFAULT_EXPECT : undefined;
    },
  };
}
