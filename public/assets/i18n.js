/**
 * StatusDog — translation engine.
 *
 * No build step and no dependency: pages carry `data-i18n` attributes, this
 * module swaps the text in. Kept free of DOM access at import time so it can be
 * unit-tested under Node, where the key-parity test lives.
 *
 * Language resolution, highest priority first:
 *   1. `?lang=` in the URL — makes a link shareable in a given language
 *   2. the reader's stored choice
 *   3. the browser's `navigator.language`
 *   4. English
 */
import { LOCALES } from './locales.js';

export const LANGUAGES = ['en', 'ko'];
export const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'statusdog.lang';

let current = DEFAULT_LANGUAGE;

export function normalizeLanguage(value) {
  const tag = String(value ?? '').trim().toLowerCase();
  if (tag === '') return null;
  // Accept `ko`, `ko-KR`, `ko_KR`.
  const base = tag.split(/[-_]/)[0];
  return LANGUAGES.includes(base) ? base : null;
}

/** Look up a key, interpolate `{placeholders}`, and pick a plural form. */
export function translate(language, key, vars = {}) {
  const table = LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
  let value = table[key];

  if (value === undefined) {
    // Fall back to English rather than showing the reader a raw key.
    value = LOCALES[DEFAULT_LANGUAGE][key];
    if (value === undefined) return key;
  }

  if (value !== null && typeof value === 'object') {
    const count = Number(vars.count ?? 0);
    value = count === 1 ? value.one : value.other;
  }

  return String(value).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function t(key, vars) {
  return translate(current, key, vars);
}

export function getLanguage() {
  return current;
}

/* ---------- browser-only helpers ---------- */

function readStored() {
  try {
    return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function store(language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private browsing; the URL parameter still works for this page view.
  }
}

export function detectLanguage() {
  const fromUrl = normalizeLanguage(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) return fromUrl;

  const stored = readStored();
  if (stored) return stored;

  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = normalizeLanguage(tag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

const TRANSLATED_ATTRIBUTES = [
  ['[data-i18n-placeholder]', 'placeholder', 'i18nPlaceholder'],
  ['[data-i18n-aria-label]', 'aria-label', 'i18nAriaLabel'],
  ['[data-i18n-title]', 'title', 'i18nTitle'],
  ['[data-i18n-content]', 'content', 'i18nContent'],
];

/**
 * Apply translations to every `data-i18n*` element under `root`.
 *
 * `data-i18n` sets text, `data-i18n-html` sets markup (for sentences that wrap a
 * link), and `data-i18n-<attr>` sets an attribute — `placeholder`, `aria-label`,
 * `title`, `content`.
 */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const [selector, attribute, dataKey] of TRANSLATED_ATTRIBUTES) {
    for (const node of root.querySelectorAll(selector)) {
      node.setAttribute(attribute, t(node.dataset[dataKey]));
    }
  }
}

/** Change language, re-render, and remember the choice. */
export function setLanguage(language, { persist = true } = {}) {
  const next = normalizeLanguage(language) ?? DEFAULT_LANGUAGE;
  current = next;
  if (persist) store(next);

  document.documentElement.lang = next;
  applyTranslations();
  markActiveLanguage();
  document.dispatchEvent(new CustomEvent('statusdog:languagechange', { detail: { language: next } }));
  return next;
}

function markActiveLanguage() {
  for (const button of document.querySelectorAll('[data-lang]')) {
    const active = button.dataset.lang === current;
    button.setAttribute('aria-current', active ? 'true' : 'false');
  }
}

/**
 * Wire up the language switcher and render the page in the resolved language.
 * Call once per page, before any dynamic content is rendered.
 */
export function initI18n() {
  setLanguage(detectLanguage(), { persist: false });

  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setLanguage(button.dataset.lang);
      // Keep the URL honest so a copied link carries the chosen language.
      const url = new URL(location.href);
      url.searchParams.set('lang', getLanguage());
      history.replaceState(null, '', url);
    });
  }

  return getLanguage();
}
