import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const moodModule = pathToFileURL(path.resolve('public/assets/office/mood.js')).href;
const dogsModule = pathToFileURL(path.resolve('public/assets/office/dogs.js')).href;

const {
  deriveMood,
  latencyBaseline,
  officeSummary,
  MOODS,
} = (await import(moodModule)) as {
  deriveMood: (monitor: unknown) => { mood: string; cause: string; baselineMs: number | null; ratio: number | null };
  latencyBaseline: (history: unknown[]) => number | null;
  officeSummary: (workers: Array<{ mood: { mood: string } }>) => { total: number; counts: Record<string, number>; worst: string };
  MOODS: string[];
};

const { dogIdentity, dogName, hashString } = (await import(dogsModule)) as {
  dogIdentity: (id: string) => { key: string; names: { en: string; ko: string }; coat: { key: string }; accessory: string; beatOffsetMs: number };
  dogName: (id: string, language: string) => string;
  hashString: (input: unknown) => number;
};

/** History of successful checks at a steady latency, newest last. */
function steady(ms: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ t: `T${i}`, ok: true, status: 200, ms, reason: null }));
}

function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'api',
    name: 'API',
    url: 'https://example.com',
    state: 'up',
    since: 'T0',
    consecutiveFailures: 0,
    maxResponseTimeMs: 0,
    lastResult: { ok: true, status: 200, responseTimeMs: 100, reason: null, message: null },
    stats: { checks: 5, uptimePct: 100, avgResponseTimeMs: 100 },
    history: steady(100, 6),
    ...overrides,
  };
}

/* ---------------- baseline ---------------- */

test('a baseline needs at least three prior successes', () => {
  assert.equal(latencyBaseline([]), null);
  assert.equal(latencyBaseline(steady(100, 3)), null, 'the last record is excluded, leaving two');
  assert.equal(latencyBaseline(steady(100, 4)), 100);
});

test('the baseline excludes the most recent check', () => {
  // Five 100ms samples then one 9000ms spike: the spike must not raise the bar
  // it is about to be compared against.
  const history = [...steady(100, 5), { t: 'T5', ok: true, status: 200, ms: 9000, reason: null }];
  assert.equal(latencyBaseline(history), 100);
});

test('the baseline is a median, so one outlier cannot redefine normal', () => {
  const history = [
    { t: '1', ok: true, ms: 100 },
    { t: '2', ok: true, ms: 100 },
    { t: '3', ok: true, ms: 30000 },
    { t: '4', ok: true, ms: 110 },
    { t: '5', ok: true, ms: 100 },
    { t: '6', ok: true, ms: 105 },
  ];
  // Excluding the last record leaves [100, 100, 30000, 110, 100]; sorted, the
  // middle value is 100. The mean would have been 6082.
  assert.equal(latencyBaseline(history), 100, 'a mean would have said ~6082');
});

test('failed checks are not part of the baseline', () => {
  const history = [
    { t: '1', ok: true, ms: 100 },
    { t: '2', ok: false, ms: 30000 },
    { t: '3', ok: true, ms: 100 },
    { t: '4', ok: true, ms: 100 },
    { t: '5', ok: true, ms: 120 },
  ];
  assert.equal(latencyBaseline(history), 100);
});

/* ---------------- moods ---------------- */

test('a healthy monitor at its usual speed is working', () => {
  const result = deriveMood(monitor());
  assert.equal(result.mood, 'working');
  assert.equal(result.cause, 'nominal');
});

test('a confirmed down monitor raises the alarm, whatever else is true', () => {
  const result = deriveMood(monitor({
    state: 'down',
    consecutiveFailures: 3,
    lastResult: { ok: false, status: null, responseTimeMs: 30000, reason: 'timeout' },
  }));
  assert.equal(result.mood, 'alarmed');
  assert.equal(result.cause, 'timeout');
});

test('a target with no checks yet is off duty, not healthy', () => {
  assert.equal(deriveMood(monitor({ state: 'unknown', lastResult: null, history: [] })).mood, 'offDuty');
  assert.equal(deriveMood({}).mood, 'offDuty', 'a bare object must not throw');
  assert.equal(deriveMood(null).mood, 'offDuty');
});

test('a failure below the threshold makes the dog uneasy, not alarmed', () => {
  const failing = deriveMood(monitor({
    state: 'up',
    consecutiveFailures: 1,
    lastResult: { ok: false, status: 503, responseTimeMs: 120, reason: 'status' },
  }));
  assert.equal(failing.mood, 'uneasy');
  assert.equal(failing.cause, 'status');

  // Recovered on the last check, but a failure happened recently.
  const recovering = deriveMood(monitor({ consecutiveFailures: 2 }));
  assert.equal(recovering.mood, 'uneasy');
  assert.equal(recovering.cause, 'recent-failure');
});

test('latency far above this target\'s own baseline is strain', () => {
  const result = deriveMood(monitor({
    lastResult: { ok: true, status: 200, responseTimeMs: 900, reason: null },
    history: [...steady(100, 5), { t: 'T5', ok: true, ms: 900 }],
  }));
  assert.equal(result.mood, 'strained');
  assert.equal(result.cause, 'above-baseline');
  assert.equal(result.baselineMs, 100);
  assert.equal(result.ratio, 9);
});

test('a small absolute jump is not strain, however large the ratio', () => {
  // 4ms → 20ms is 5x but nobody cares.
  const result = deriveMood(monitor({
    lastResult: { ok: true, status: 200, responseTimeMs: 20, reason: null },
    history: [...steady(4, 5), { t: 'T5', ok: true, ms: 20 }],
  }));
  assert.equal(result.mood, 'working');
});

test('a consistently slow site is working, not permanently strained', () => {
  const result = deriveMood(monitor({
    lastResult: { ok: true, status: 200, responseTimeMs: 3000, reason: null },
    history: steady(3000, 8),
  }));
  assert.equal(result.mood, 'working', '3s is this target\'s normal');
});

test('closing on the configured limit is strain even without a baseline', () => {
  const result = deriveMood(monitor({
    maxResponseTimeMs: 2000,
    lastResult: { ok: true, status: 200, responseTimeMs: 1500, reason: null },
    history: [],
  }));
  assert.equal(result.mood, 'strained');
  assert.equal(result.cause, 'near-limit');
});

test('comfortably under the configured limit is fine', () => {
  const result = deriveMood(monitor({
    maxResponseTimeMs: 2000,
    lastResult: { ok: true, status: 200, responseTimeMs: 300, reason: null },
    history: steady(300, 6),
  }));
  assert.equal(result.mood, 'working');
});

test('every mood produced is one the UI knows how to draw', () => {
  const cases = [
    monitor(),
    monitor({ state: 'down' }),
    monitor({ state: 'unknown', lastResult: null }),
    monitor({ consecutiveFailures: 1 }),
    monitor({ maxResponseTimeMs: 100, lastResult: { ok: true, responseTimeMs: 99, reason: null } }),
  ];
  for (const input of cases) {
    assert.ok(MOODS.includes(deriveMood(input).mood), 'unknown mood would render as a blank desk');
  }
});

/* ---------------- dog identity ---------------- */

test('a target always gets the same dog', () => {
  const first = dogIdentity('copykiller');
  const second = dogIdentity('copykiller');
  assert.deepEqual(first, second);
  assert.equal(dogName('copykiller', 'en'), first.names.en);
});

test('different targets generally get different dogs', () => {
  const ids = ['copykiller', 'copykiller-apex', 'statusdog', 'api', 'marketing', 'admin'];
  const keys = new Set(ids.map((id) => dogIdentity(id).key));
  assert.ok(keys.size >= 4, `expected variety, got ${keys.size} distinct dogs`);
});

test('a dog is fully specified — no undefined reaching the DOM', () => {
  for (const id of ['a', 'copykiller', 'x'.repeat(200), '한글-아이디']) {
    const dog = dogIdentity(id);
    assert.ok(dog.key);
    assert.ok(dog.names.en && dog.names.ko);
    assert.ok(dog.coat.key && dog.coat.body && dog.coat.ear && dog.coat.patch);
    assert.ok(typeof dog.accessory === 'string' && dog.accessory !== '');
    assert.ok(Number.isInteger(dog.beatOffsetMs) && dog.beatOffsetMs >= 0 && dog.beatOffsetMs < 900);
  }
});

test('dogName falls back to English for an unknown language', () => {
  assert.equal(dogName('api', 'de'), dogIdentity('api').names.en);
});

test('hashString is stable and handles odd input', () => {
  assert.equal(hashString('copykiller'), hashString('copykiller'));
  assert.notEqual(hashString('a'), hashString('b'));
  assert.ok(Number.isInteger(hashString('')));
  assert.ok(Number.isInteger(hashString(null)));
});

/* ---------------- office summary ---------------- */

test('the office summary reports the worst thing happening', () => {
  const worker = (mood: string) => ({ mood: { mood } });

  assert.equal(officeSummary([]).worst, 'empty');
  assert.equal(officeSummary([worker('working'), worker('working')]).worst, 'working');
  assert.equal(officeSummary([worker('working'), worker('strained')]).worst, 'strained');
  assert.equal(officeSummary([worker('strained'), worker('uneasy')]).worst, 'uneasy');
  assert.equal(officeSummary([worker('uneasy'), worker('alarmed')]).worst, 'alarmed');
  assert.equal(officeSummary([worker('offDuty')]).worst, 'offDuty');

  const summary = officeSummary([worker('working'), worker('working'), worker('alarmed')]);
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.working, 2);
  assert.equal(summary.counts.alarmed, 1);
  assert.equal(summary.counts.strained, 0, 'every mood is present as a zero, not undefined');
});

/* ---------------- keys the office builds at runtime ---------------- */

const { LOCALES } = (await import(
  pathToFileURL(path.resolve('public/assets/locales.js')).href
)) as { LOCALES: Record<string, Record<string, unknown>> };

test('every mood has the copy the desk and the report build by template', () => {
  // These keys are assembled as `office.mood.${mood}.short`, so the static scan
  // in the i18n suite cannot see them. Adding a mood without its copy would
  // otherwise print the raw key onto a desk.
  for (const language of ['en', 'ko']) {
    for (const mood of MOODS) {
      for (const suffix of ['short', 'line']) {
        const key = `office.mood.${mood}.${suffix}`;
        assert.ok(LOCALES[language]![key], `${language} is missing ${key}`);
      }
    }
  }
});

test('every mood maps to a CSS custom property the stylesheet defines', () => {
  const css = readFileSync(path.resolve('public/assets/office.css'), 'utf8');
  for (const mood of MOODS) {
    // ServerReportModal lowercases offDuty to match the token naming.
    const token = mood === 'offDuty' ? 'offduty' : mood;
    assert.ok(
      css.includes(`--mood-${token}:`),
      `office.css defines no --mood-${token}, so this mood would render uncoloured`,
    );
    assert.ok(
      css.includes(`[data-mood="${mood}"]`),
      `office.css has no rule for data-mood="${mood}"`,
    );
  }
});

test('every mood line addresses the dog by name', () => {
  for (const language of ['en', 'ko']) {
    for (const mood of MOODS) {
      const line = String(LOCALES[language]![`office.mood.${mood}.line`]);
      assert.ok(line.includes('{dog}'), `${language} ${mood} line drops the dog's name`);
    }
  }
});

test('failures while still "unknown" read as uneasy, not idle', () => {
  // A high failureThreshold keeps state at 'unknown' through several failures.
  // That dog has seen something go wrong and should not look idle.
  const result = deriveMood(monitor({
    state: 'unknown',
    consecutiveFailures: 5,
    lastResult: { ok: false, status: 404, responseTimeMs: 150, reason: 'status' },
  }));
  assert.equal(result.mood, 'uneasy');
  assert.equal(result.cause, 'status');
});

test('"unknown" with no result at all is still off duty', () => {
  assert.equal(
    deriveMood(monitor({ state: 'unknown', consecutiveFailures: 0, lastResult: null })).mood,
    'offDuty',
  );
});
