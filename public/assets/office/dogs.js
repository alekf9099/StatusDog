/**
 * StatusDog Office — who the dogs are.
 *
 * Split from mood.js so the two concerns stay apart: that module decides how a
 * dog *feels*, this one decides who it *is*.
 *
 * Identity comes from three layers, each overriding the last:
 *
 *   1. a hash of the target id — every monitor has a dog without anyone choosing
 *   2. a stored assignment — rolled once when a site is hired, then kept
 *   3. a stored override — a name or a look someone picked deliberately
 *
 * Rolling once and storing it, rather than re-rolling per render, is the whole
 * point: a dog you cannot recognise tomorrow is not a colleague.
 */

/** Breed names are data, not UI copy: a dog keeps its name when the language changes. */
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
  { key: 'gamja', en: 'Gamja', ko: '감자' },
  { key: 'byeol', en: 'Byeol', ko: '별이' },
  { key: 'ttosuni', en: 'Ttosun', ko: '또순이' },
  { key: 'chal', en: 'Chal', ko: '찰떡' },
];

/** Coats are colour triples so both themes stay legible. */
const COATS = [
  { key: 'cream', body: '#e8c9a0', ear: '#cda679', patch: '#f5e3cb' },
  { key: 'cocoa', body: '#a9754f', ear: '#8a5b3b', patch: '#d6ae8b' },
  { key: 'charcoal', body: '#6f7480', ear: '#565b66', patch: '#9aa1ad' },
  { key: 'ginger', body: '#dd9b52', ear: '#c07f3a', patch: '#f2c48b' },
  { key: 'snow', body: '#e6e9ee', ear: '#c8cdd6', patch: '#f7f9fb' },
  { key: 'sesame', body: '#c9a26b', ear: '#a07f4e', patch: '#e6cfa8' },
  { key: 'slate', body: '#8d9bb0', ear: '#6d7b90', patch: '#b6c1d0' },
  { key: 'toffee', body: '#c98a52', ear: '#a56c39', patch: '#e3b587' },
];

const ACCESSORIES = ['none', 'collar', 'scarf', 'cap'];

/** A rename cannot be longer than this, or it breaks the nameplate. */
export const MAX_DOG_NAME_LENGTH = 20;

export const DOG_KEYS = DOGS.map((dog) => dog.key);
export const COAT_KEYS = COATS.map((coat) => coat.key);
export { ACCESSORIES };

export function dogByKey(key) {
  return DOGS.find((dog) => dog.key === key) ?? null;
}

export function coatByKey(key) {
  return COATS.find((coat) => coat.key === key) ?? null;
}

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
 * The dog a target gets when nobody has chosen one. Deterministic, so a roster
 * target that has never been touched still has a consistent colleague.
 */
export function dogIdentity(id) {
  const hash = hashString(id);
  const dog = DOGS[hash % DOGS.length];
  const coat = COATS[Math.floor(hash / DOGS.length) % COATS.length];
  const accessory = ACCESSORIES[Math.floor(hash / (DOGS.length * COATS.length)) % ACCESSORIES.length];

  return {
    key: dog.key,
    names: { en: dog.en, ko: dog.ko },
    custom: false,
    coat,
    accessory,
    /** Per-dog animation offset so a room of dogs does not move in lockstep. */
    beatOffsetMs: hash % 900,
  };
}

/**
 * Roll a look. Called once when a site is hired, and again only if someone asks
 * for a different dog — the result is stored either way.
 *
 * `rng` is injectable so the roll can be tested.
 */
export function randomDogAssignment(rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length) % list.length];
  return {
    dog: pick(DOG_KEYS),
    coat: pick(COAT_KEYS),
    accessory: pick(ACCESSORIES),
  };
}

/**
 * Clean up a name someone typed. Returns `null` for anything unusable, so the
 * caller falls back to the breed name rather than rendering a blank nameplate.
 */
export function sanitizeDogName(input) {
  if (typeof input !== 'string') return null;
  // Collapse whitespace and strip control characters, which would break layout.
  const cleaned = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.slice(0, MAX_DOG_NAME_LENGTH);
}

/**
 * Resolve a dog from its id and whatever has been stored about it.
 *
 * A partial override is fine and common: `{ name: 'Bibim' }` renames the dog and
 * leaves the hashed look alone.
 */
export function resolveDog(id, override = null) {
  const base = dogIdentity(id);
  const breed = override?.dog ? dogByKey(override.dog) : null;
  const coat = override?.coat ? coatByKey(override.coat) : null;
  const custom = sanitizeDogName(override?.name);

  const names = custom !== null
    ? { en: custom, ko: custom }
    : breed
      ? { en: breed.en, ko: breed.ko }
      : base.names;

  return {
    key: breed?.key ?? base.key,
    names,
    custom: custom !== null,
    coat: coat ?? base.coat,
    accessory: ACCESSORIES.includes(override?.accessory) ? override.accessory : base.accessory,
    beatOffsetMs: base.beatOffsetMs,
  };
}

export function dogName(id, language, override = null) {
  const { names } = resolveDog(id, override);
  return names[language] ?? names.en;
}
