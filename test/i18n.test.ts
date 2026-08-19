import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The site's translation files are browser modules with no DOM access at import
 * time, precisely so they can be checked here: a missing or malformed Korean
 * string is a silent visual bug otherwise.
 */
const assets = path.resolve('public/assets');

const { LOCALES } = (await import(pathToFileURL(path.join(assets, 'locales.js')).href)) as {
  LOCALES: Record<string, Record<string, unknown>>;
};
const { normalizeLanguage, translate, LANGUAGES } = (await import(
  pathToFileURL(path.join(assets, 'i18n.js')).href
)) as {
  normalizeLanguage: (value: unknown) => string | null;
  translate: (language: string, key: string, vars?: Record<string, unknown>) => string;
  LANGUAGES: string[];
};

/** `{name}` placeholders used by a value, whichever plural form it takes. */
function placeholdersOf(value: unknown): Set<string> {
  const texts =
    value !== null && typeof value === 'object'
      ? Object.values(value as Record<string, string>)
      : [String(value)];
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{(\w+)\}/g)) found.add(match[1]!);
  }
  return found;
}

test('every declared language has a table', () => {
  for (const language of LANGUAGES) {
    assert.ok(LOCALES[language], `${language} is declared but has no strings`);
  }
});

test('Korean covers every English key, and adds none of its own', () => {
  const en = Object.keys(LOCALES.en!).sort();
  const ko = Object.keys(LOCALES.ko!).sort();

  const missing = en.filter((key) => !ko.includes(key));
  const extra = ko.filter((key) => !en.includes(key));

  assert.deepEqual(missing, [], 'untranslated keys');
  assert.deepEqual(extra, [], 'Korean-only keys that no page can reach');
});

test('no string is left empty or accidentally identical to its key', () => {
  for (const [language, table] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(table)) {
      const texts =
        value !== null && typeof value === 'object'
          ? Object.values(value as Record<string, string>)
          : [value];
      for (const text of texts) {
        assert.equal(typeof text, 'string', `${language}.${key} is not a string`);
        assert.notEqual(String(text).trim(), '', `${language}.${key} is empty`);
        assert.notEqual(String(text), key, `${language}.${key} is just the key`);
      }
    }
  }
});

test('translations keep the placeholders their English source uses', () => {
  for (const [key, value] of Object.entries(LOCALES.en!)) {
    const expected = [...placeholdersOf(value)].sort();
    const actual = [...placeholdersOf(LOCALES.ko![key])].sort();
    assert.deepEqual(actual, expected, `ko.${key} placeholders drifted`);
  }
});

test('keys ending in Html are the only ones allowed to contain markup', () => {
  for (const [language, table] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(table)) {
      if (key.endsWith('Html')) continue;
      const texts =
        value !== null && typeof value === 'object'
          ? Object.values(value as Record<string, string>)
          : [String(value)];
      for (const text of texts) {
        assert.ok(
          !/<[a-z/][^>]*>/i.test(text),
          `${language}.${key} contains markup but is inserted as text`,
        );
      }
    }
  }
});

test('translate interpolates, pluralises, and falls back', () => {
  assert.equal(translate('en', 'value.days', { n: 42 }), '42d');
  assert.equal(translate('ko', 'value.days', { n: 42 }), '42일');

  assert.equal(translate('en', 'dash.summary.targets', { count: 1 }), '1 target');
  assert.equal(translate('en', 'dash.summary.targets', { count: 3 }), '3 targets');
  assert.equal(translate('ko', 'dash.summary.targets', { count: 3 }), '대상 3개');

  assert.equal(translate('ko', 'nav.home'), '홈');
  assert.equal(translate('de', 'nav.home'), 'Home', 'unknown language falls back to English');
  assert.equal(translate('en', 'no.such.key'), 'no.such.key', 'a missing key shows itself');
});

test('an unfilled placeholder is left visible rather than becoming "undefined"', () => {
  assert.equal(translate('en', 'value.days', {}), '{n}d');
});

test('normalizeLanguage accepts real Accept-Language shapes', () => {
  assert.equal(normalizeLanguage('ko'), 'ko');
  assert.equal(normalizeLanguage('ko-KR'), 'ko');
  assert.equal(normalizeLanguage('ko_KR'), 'ko');
  assert.equal(normalizeLanguage('KO-kr'), 'ko');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('ja'), null);
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage(null), null);
});

test('every key the pages reference exists', () => {
  // Catches a data-i18n typo, which would otherwise render the raw key on screen.
  const pages = ['index.html', 'check.html', 'dashboard.html', 'docs.html', 'office.html'];
  const scripts = [
    'statusdog.js',
    'office/DogWorkerCard.js',
    'office/ServerReportModal.js',
    'office/OfficeDashboard.js',
    'office/dogs.js',
    'office/overrides.js',
    'office/url.js',
  ];
  const known = new Set(Object.keys(LOCALES.en!));
  const referenced = new Set<string>();

  for (const file of pages) {
    const html = readFileSync(path.join('public', file), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
      referenced.add(match[1]!);
    }
  }
  for (const file of scripts) {
    const source = readFileSync(path.join(assets, file), 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) referenced.add(match[1]!);
  }

  assert.ok(referenced.size > 0, 'no keys found — did the scan pattern break?');
  const unknown = [...referenced].filter((key) => !known.has(key)).sort();
  assert.deepEqual(unknown, [], 'referenced keys with no translation');
});
