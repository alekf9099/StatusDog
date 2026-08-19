/**
 * StatusDog Office — the logic half.
 *
 * Two pure concerns, deliberately free of DOM access so they can be unit-tested:
 *
 *   1. `deriveMood` turns a monitor's raw numbers into how its dog is feeling.
 *   2. `dogIdentity` gives each target a stable dog — same name and coat on every
 *      visit, from a hash of the target id rather than a random draw.
 *
 * The moods are not decoration. `strained` in particular reports something the
 * plain dashboard does not: latency well above this target's *own* baseline, or
 * closing on the limit its config sets. A site that normally answers in 96ms and
 * suddenly takes 400ms is in trouble; one that always takes 3s is not.
 */

export const MOODS = ['offDuty', 'working', 'strained', 'uneasy', 'alarmed'];

/** A latency spike must be this many times the baseline to count. */
const SPIKE_RATIO = 2;
/** …and at least this many ms above it, so 4ms → 9ms is not a crisis. */
const SPIKE_FLOOR_MS = 150;
/** Fraction of a configured maxResponseTimeMs that counts as "closing on it". */
const LIMIT_WARN_FRACTION = 0.7;
/** Below this many successful samples there is no baseline worth comparing to. */
const MIN_BASELINE_SAMPLES = 3;

/**
 * Median response time of the successful checks in `history`, excluding the most
 * recent one so a spike cannot raise the bar it is being measured against.
 *
 * Median rather than mean: one 30s timeout should not redefine "normal".
 */
export function latencyBaseline(history = []) {
  const samples = history
    .slice(0, -1)
    .filter((record) => record && record.ok && Number.isFinite(record.ms))
    .map((record) => record.ms)
    .sort((a, b) => a - b);

  if (samples.length < MIN_BASELINE_SAMPLES) return null;

  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 === 0
    ? Math.round((samples[middle - 1] + samples[middle]) / 2)
    : samples[middle];
}

/**
 * How is this monitor's dog doing?
 *
 * Returns `{ mood, cause, lastMs, baselineMs, ratio, limitMs }`. `cause` names
 * the evidence so the UI can explain itself instead of just looking worried.
 */
export function deriveMood(monitor) {
  const lastResult = monitor?.lastResult ?? null;
  const history = monitor?.history ?? [];
  const limitMs = Number(monitor?.maxResponseTimeMs) || 0;
  const lastMs = lastResult && Number.isFinite(lastResult.responseTimeMs)
    ? lastResult.responseTimeMs
    : null;
  const baselineMs = latencyBaseline(history);
  const ratio = baselineMs && lastMs !== null && baselineMs > 0
    ? Math.round((lastMs / baselineMs) * 100) / 100
    : null;

  const base = { lastMs, baselineMs, ratio, limitMs };

  // Confirmed down beats everything: the alarm is the point.
  if (monitor?.state === 'down') {
    return { ...base, mood: 'alarmed', cause: lastResult?.reason ?? 'down' };
  }

  // Nothing measured yet — the dog has not started work. Note this tests only for
  // a missing result, not for state 'unknown': a target with a high
  // failureThreshold can have failed several times and still be 'unknown',
  // and that dog should look worried rather than idle.
  if (!lastResult) {
    return { ...base, mood: 'offDuty', cause: 'no-checks' };
  }

  // A failure that has not yet crossed failureThreshold. Real signal, not an
  // outage: worth showing, worth not paging anyone about.
  if (!lastResult.ok) {
    return { ...base, mood: 'uneasy', cause: lastResult.reason ?? 'failed' };
  }
  if (Number(monitor?.consecutiveFailures) > 0) {
    return { ...base, mood: 'uneasy', cause: 'recent-failure' };
  }

  // Closing on the limit this target's own config sets.
  if (limitMs > 0 && lastMs !== null && lastMs > limitMs * LIMIT_WARN_FRACTION) {
    return { ...base, mood: 'strained', cause: 'near-limit' };
  }

  // Well above what this target normally does.
  if (
    baselineMs !== null &&
    lastMs !== null &&
    lastMs > baselineMs * SPIKE_RATIO &&
    lastMs - baselineMs > SPIKE_FLOOR_MS
  ) {
    return { ...base, mood: 'strained', cause: 'above-baseline' };
  }

  return { ...base, mood: 'working', cause: 'nominal' };
}

/* ---------------- dog identity ---------------- */

/**
 * Dogs are data, not UI copy, so they live here rather than in the locale
 * tables: a monitor should keep the same dog when the language changes.
 */
const DOGS = [
  { key: 'mocha', en: 'Mocha', ko: '모카' },
  { key: 'coco', en: 'Coco', ko: '코코' },
  { key: 'bori', en: 'Bori', ko: '보리' },
  { key: 'kongi', en: 'Kongi', ko: '콩이' },
  { key: 'bam', en: 'Bam', ko: '밤이' },
  { key: 'dubu', en: 'Dubu', ko: '두부' },
  { key: 'haru', en: 'Haru', ko: '하루' },
  { key: 'nuri', en: 'Nuri', ko: '누리' },
  { key: 'mango', en: 'Mango', ko: '망고' },
  { key: 'sol', en: 'Sol', ko: '솔이' },
  { key: 'tori', en: 'Tori', ko: '토리' },
  { key: 'pudding', en: 'Pudding', ko: '푸딩' },
];

/** Coats are CSS custom-property triples so both themes stay legible. */
const COATS = [
  { key: 'cream', body: '#e8c9a0', ear: '#cda679', patch: '#f5e3cb' },
  { key: 'cocoa', body: '#a9754f', ear: '#8a5b3b', patch: '#d6ae8b' },
  { key: 'charcoal', body: '#6f7480', ear: '#565b66', patch: '#9aa1ad' },
  { key: 'ginger', body: '#dd9b52', ear: '#c07f3a', patch: '#f2c48b' },
  { key: 'snow', body: '#e6e9ee', ear: '#c8cdd6', patch: '#f7f9fb' },
  { key: 'sesame', body: '#c9a26b', ear: '#a07f4e', patch: '#e6cfa8' },
];

const ACCESSORIES = ['none', 'collar', 'scarf', 'cap'];

/** FNV-1a. Small, stable, and not a security boundary — just a spread. */
export function hashString(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The dog assigned to a monitor id. Deterministic, so the same target is always
 * greeted by the same colleague.
 */
export function dogIdentity(id) {
  const hash = hashString(id);
  const dog = DOGS[hash % DOGS.length];
  const coat = COATS[Math.floor(hash / DOGS.length) % COATS.length];
  const accessory = ACCESSORIES[Math.floor(hash / (DOGS.length * COATS.length)) % ACCESSORIES.length];

  return {
    key: dog.key,
    names: { en: dog.en, ko: dog.ko },
    coat,
    accessory,
    /** Small per-dog animation offset so a room of dogs does not move in lockstep. */
    beatOffsetMs: hash % 900,
  };
}

export function dogName(id, language) {
  const { names } = dogIdentity(id);
  return names[language] ?? names.en;
}

/** Roster targets are permanent staff; browser-local ones clock out with the tab. */
export function employmentOf(monitor) {
  return monitor?.kind === 'intern' ? 'intern' : 'staff';
}

/** Office-wide summary, for the header line. */
export function officeSummary(workers = []) {
  const counts = Object.fromEntries(MOODS.map((mood) => [mood, 0]));
  for (const worker of workers) counts[worker.mood.mood] = (counts[worker.mood.mood] ?? 0) + 1;

  return {
    total: workers.length,
    counts,
    /** The single worst thing happening, for the room's overall tone. */
    worst: counts.alarmed > 0
      ? 'alarmed'
      : counts.uneasy > 0
        ? 'uneasy'
        : counts.strained > 0
          ? 'strained'
          : workers.length === 0
            ? 'empty'
            : counts.working > 0
              ? 'working'
              : 'offDuty',
  };
}
