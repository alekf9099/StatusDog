import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAUSE_LIMIT,
  emptyNotes,
  findNote,
  NOTE_LIMIT,
  normalizeText,
  publicNote,
  readNotes,
  upsertNote,
  writeNotes,
  type NoteLog,
} from '../src/store/notes.js';
import type { KvClient } from '../src/store/kv.js';

const AT = '2026-08-20T04:00:00.000Z';
const INCIDENT = '2026-08-20T03:00:00.000Z';

function log(): NoteLog {
  return emptyNotes('copykiller');
}

function written(over: Partial<Parameters<typeof upsertNote>[1]> = {}): NoteLog {
  return upsertNote(log(), {
    incidentId: INCIDENT,
    cause: 'Origin ran out of connections',
    action: 'Raised the pool size and restarted',
    author: 'Owner@Example.com',
    at: AT,
    ...over,
  });
}

/* ---------------- text handling ---------------- */

test('text is trimmed and newlines normalised', () => {
  assert.equal(normalizeText('  hello  ', 100), 'hello');
  assert.equal(normalizeText('a\r\nb', 100), 'a\nb');
  assert.equal(normalizeText(undefined, 100), '');
  assert.equal(normalizeText(null, 100), '');
  assert.equal(normalizeText(42, 100), '42');
});

test('long text is capped rather than rejected', () => {
  // Losing the tail of an over-long postmortem beats refusing to save it.
  assert.equal(normalizeText('x'.repeat(5_000), CAUSE_LIMIT).length, CAUSE_LIMIT);
});

/* ---------------- writing ---------------- */

test('a note records both halves and who wrote it', () => {
  const note = findNote(written(), INCIDENT);
  assert.equal(note?.cause, 'Origin ran out of connections');
  assert.equal(note?.action, 'Raised the pool size and restarted');
  assert.equal(note?.author, 'owner@example.com', 'stored lowercased');
  assert.equal(note?.updatedAt, AT);
});

test('writing again replaces rather than duplicating', () => {
  const first = written();
  const second = upsertNote(first, {
    incidentId: INCIDENT,
    cause: 'Actually a bad deploy',
    action: 'Rolled back',
    author: 'owner@example.com',
    at: '2026-08-20T05:00:00.000Z',
  });
  assert.equal(second.notes.length, 1);
  assert.equal(findNote(second, INCIDENT)?.cause, 'Actually a bad deploy');
  assert.equal(findNote(second, INCIDENT)?.updatedAt, '2026-08-20T05:00:00.000Z');
});

test('clearing both fields deletes the note', () => {
  // The owner emptying the boxes means "remove this", not "store two empty strings".
  const cleared = upsertNote(written(), {
    incidentId: INCIDENT,
    cause: '   ',
    action: '',
    author: 'owner@example.com',
    at: AT,
  });
  assert.equal(cleared.notes.length, 0);
  assert.equal(findNote(cleared, INCIDENT), null);
});

test('one half is enough to keep a note', () => {
  const causeOnly = written({ action: '' });
  assert.equal(findNote(causeOnly, INCIDENT)?.action, '');
  assert.ok(findNote(causeOnly, INCIDENT)?.cause);
});

test('notes for other incidents are left alone', () => {
  let notes = written();
  notes = upsertNote(notes, {
    incidentId: '2026-08-01T00:00:00.000Z',
    cause: 'Different outage',
    action: '',
    author: 'owner@example.com',
    at: AT,
  });
  assert.equal(notes.notes.length, 2);
  assert.equal(findNote(notes, INCIDENT)?.cause, 'Origin ran out of connections');
});

test('the log is bounded, keeping the most recent notes', () => {
  let notes = log();
  for (let i = 0; i < NOTE_LIMIT + 5; i++) {
    notes = upsertNote(notes, {
      incidentId: `2026-08-20T00:00:00.${String(i).padStart(3, '0')}Z`,
      cause: `note ${i}`,
      action: '',
      author: 'owner@example.com',
      at: AT,
    });
  }
  assert.equal(notes.notes.length, NOTE_LIMIT);
  assert.equal(notes.notes.at(-1)?.cause, `note ${NOTE_LIMIT + 4}`);
});

/* ---------------- what a reader gets ---------------- */

test("the author's address is never part of the public shape", () => {
  // A status page is public. The words belong on it; the email does not.
  const note = findNote(written(), INCIDENT)!;
  const shown = publicNote(note);
  assert.equal('author' in shown, false);
  assert.equal(JSON.stringify(shown).includes('example.com'), false);
  assert.equal(shown.cause, note.cause);
  assert.equal(shown.updatedAt, note.updatedAt);
});

/* ---------------- persistence ---------------- */

function fakeKv(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    origin: 'memory',
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

test('notes round-trip through the store', async () => {
  const kv = fakeKv();
  await writeNotes(kv, written());
  const read = await readNotes(kv, 'copykiller');
  assert.equal(findNote(read, INCIDENT)?.cause, 'Origin ran out of connections');
});

test('notes live in their own key, away from the scheduler', async () => {
  // Sharing the incident log would mean a cron run and a saved postmortem could
  // overwrite each other, and losing hand-written words that way is unacceptable.
  const kv = fakeKv();
  await writeNotes(kv, written());
  const keys = [...kv.data.keys()];
  assert.deepEqual(keys, ['statusdog:v1:notes:copykiller']);
  assert.ok(!keys.some((key) => key.includes('incidents') || key.includes('stats')));
});

test('a missing or corrupt log reads as empty rather than throwing', async () => {
  const kv = fakeKv();
  assert.deepEqual(await readNotes(kv, 'nothing'), emptyNotes('nothing'));

  await kv.set('statusdog:v1:notes:broken', '{not json');
  const read = await readNotes(kv, 'broken');
  assert.deepEqual(read.notes, [], 'a corrupt log must not block the next write');
});
