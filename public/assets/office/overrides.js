/**
 * Where a renamed or re-rolled dog is remembered.
 *
 * This is localStorage, which makes overrides **per browser**. That is a
 * deliberate limit, not an oversight: the hosted site has no accounts, so a
 * server-side rename endpoint would let any visitor rename dogs for everyone.
 * Naming your own colleagues on your own machine needs no such endpoint.
 *
 * Keyed by the worker uid (`staff:copykiller`, `intern:m_ab12cd34`) so a roster
 * target and a browser monitor cannot tread on each other.
 *
 * MIGRATION SEAM: Google account login is planned. When it lands, per-user state
 * moves server-side and `createDogOverrideStore` takes a server-backed adapter
 * instead of `localStorage` — nothing else in the office has to change. That is
 * why the storage object is a parameter rather than being reached for inline.
 */
import { randomDogAssignment, sanitizeDogName } from './dogs.js';

const STORAGE_KEY = 'statusdog.dogs.v1';

/** Fallback when there is no localStorage — Node tests, or a locked-down browser. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

function defaultStorage() {
  try {
    // Touch it: Safari in private mode throws on access rather than on write.
    const probe = globalThis.localStorage;
    if (probe) {
      probe.getItem(STORAGE_KEY);
      return probe;
    }
  } catch {
    // fall through
  }
  return memoryStorage();
}

export function createDogOverrideStore(storage = defaultStorage()) {
  function readAll() {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // A corrupt blob should cost you your dog names, not the whole office.
      return {};
    }
  }

  function writeAll(all) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Storage full or blocked; the override simply does not survive a reload.
    }
  }

  return {
    all: readAll,

    get(uid) {
      return readAll()[uid] ?? null;
    },

    /** Merge a patch. Keys set to `null` are removed, so a rename can be undone. */
    patch(uid, patch) {
      const all = readAll();
      const next = { ...all[uid], ...patch };
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === undefined) delete next[key];
      }
      if (Object.keys(next).length === 0) delete all[uid];
      else all[uid] = next;
      writeAll(all);
      return all[uid] ?? null;
    },

    /** `null` or a blank name clears the override and restores the breed name. */
    rename(uid, name) {
      return this.patch(uid, { name: sanitizeDogName(name) });
    },

    /** Roll a fresh look, keeping any custom name. */
    reroll(uid, rng) {
      return this.patch(uid, randomDogAssignment(rng));
    },

    clear(uid) {
      const all = readAll();
      delete all[uid];
      writeAll(all);
    },

    /** Used when a monitor is let go, so its overrides do not linger forever. */
    forget(uid) {
      this.clear(uid);
    },
  };
}

export const dogOverrides = createDogOverrideStore();
