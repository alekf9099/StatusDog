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

/**
 * The coat a colleague wears to work: `body` is the cloth, `ear` its shade and
 * `patch` the collar and cuffs. These were fur colours when the dogs were drawn
 * by hand; the keys and the stored choices carry over, so a colleague who was
 * "slate" before now wears slate rather than being re-dressed at random.
 */
const COATS = [
  { key: 'cream', body: '#eadcc2', ear: '#cbb894', patch: '#fbf4e6' },
  { key: 'cocoa', body: '#8f5f40', ear: '#6c442c', patch: '#c79a74' },
  { key: 'charcoal', body: '#535a68', ear: '#3b404b', patch: '#8b93a2' },
  { key: 'ginger', body: '#d6a23a', ear: '#b0811f', patch: '#f0cf7c' },
  { key: 'snow', body: '#eef1f5', ear: '#c9d0da', patch: '#ffffff' },
  { key: 'sesame', body: '#8ea779', ear: '#6c8659', patch: '#c3d4b2' },
  { key: 'slate', body: '#5f80b2', ear: '#46659a', patch: '#a3b9da' },
  { key: 'toffee', body: '#b9675c', ear: '#934c43', patch: '#e2a198' },
];

const ACCESSORIES = ['none', 'collar', 'scarf', 'cap'];

/**
 * What kind of animal sits at the desk.
 *
 * Drawn from Microsoft's Fluent Emoji 3D set (MIT; see animals/LICENSE.txt),
 * shipped as small WebP files rather than hotlinked, so the office never depends
 * on someone else's CDN being up.
 *
 * Dogs are listed several times in the pool on purpose: this is StatusDog, and
 * the office should read as dogs with a few friends rather than a zoo.
 */
const SPECIES = [
  // `fur` and `furShade` colour the paws drawn under the portrait, sampled from it.
  { key: 'dog', en: 'Dog', ko: '강아지', fur: '#e2b07e', furShade: '#a26c49' },
  { key: 'cat', en: 'Cat', ko: '고양이', fur: '#f6c650', furShade: '#df9b1f' },
  { key: 'fox', en: 'Fox', ko: '여우', fur: '#f3893a', furShade: '#c8601c' },
  { key: 'hamster', en: 'Hamster', ko: '햄스터', fur: '#f5b587', furShade: '#d98b62' },
  { key: 'rabbit', en: 'Rabbit', ko: '토끼', fur: '#e6e6ec', furShade: '#b6b6c3' },
  { key: 'bear', en: 'Bear', ko: '곰', fur: '#9b6657', furShade: '#6d4337' },
  // A panda's arms are black, whatever its face is.
  { key: 'panda', en: 'Panda', ko: '판다', fur: '#4b4757', furShade: '#2b2934' },
  { key: 'raccoon', en: 'Raccoon', ko: '너구리', fur: '#b5b5bd', furShade: '#83838e' },
  { key: 'koala', en: 'Koala', ko: '코알라', fur: '#a3a3ab', furShade: '#74747d' },
  { key: 'tiger', en: 'Tiger', ko: '호랑이', fur: '#f39b4d', furShade: '#cf651c' },
];
const SPECIES_POOL = ['dog', 'dog', 'dog', 'dog', ...SPECIES.slice(1).map((species) => species.key)];

/** A rename cannot be longer than this, or it breaks the nameplate. */
export const MAX_DOG_NAME_LENGTH = 20;

export const DOG_KEYS = DOGS.map((dog) => dog.key);
export const COAT_KEYS = COATS.map((coat) => coat.key);
export const SPECIES_KEYS = SPECIES.map((species) => species.key);
export { ACCESSORIES };

export function dogByKey(key) {
  return DOGS.find((dog) => dog.key === key) ?? null;
}

export function coatByKey(key) {
  return COATS.find((coat) => coat.key === key) ?? null;
}

export function speciesByKey(key) {
  return SPECIES.find((species) => species.key === key) ?? null;
}

/** Where a species' portrait lives. */
export function speciesImage(key) {
  return `/assets/office/animals/${speciesByKey(key)?.key ?? 'dog'}.webp`;
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
  // Its own hash, so adding species did not reshuffle every existing name and coat.
  const species = speciesByKey(SPECIES_POOL[hashString(`species:${id}`) % SPECIES_POOL.length]);

  return {
    key: dog.key,
    names: { en: dog.en, ko: dog.ko },
    custom: false,
    coat,
    accessory,
    species,
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
    species: pick(SPECIES_POOL),
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
  const species = override?.species ? speciesByKey(override.species) : null;
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
    // A look rolled before species existed has none stored; it keeps the hashed one.
    species: species ?? base.species,
    beatOffsetMs: base.beatOffsetMs,
  };
}

export function dogName(id, language, override = null) {
  const { names } = resolveDog(id, override);
  return names[language] ?? names.en;
}
