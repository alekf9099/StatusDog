import type { KvClient } from './kv.js';

/**
 * The half of an incident report a probe cannot write.
 *
 * `src/store/incident.ts` records what was observed and refuses to guess at a
 * cause. This is where a person fills that in: what actually broke, and what was
 * done about it.
 *
 * Two decisions shape the storage:
 *
 * - **Its own key, not the incident log.** The log is written by the scheduler and
 *   these are written by the owner. Sharing a key would mean a cron run and a note
 *   being saved at the same moment could overwrite each other, and losing a
 *   hand-written postmortem to a read-modify-write race is unacceptable in a way
 *   that losing a bucket count is not.
 * - **The author is stored but never served.** Knowing which owner wrote a note is
 *   useful in the record; publishing an email address on a public status page is
 *   not. {@link publicNote} is what the read API returns.
 */

const KEY_PREFIX = 'statusdog:v1:notes:';

/** Long enough for a real postmortem, short enough to stay a note. */
export const CAUSE_LIMIT = 2_000;
export const ACTION_LIMIT = 2_000;
/** Notes kept per target, matching the incident report limit. */
export const NOTE_LIMIT = 30;

export interface IncidentNote {
  /** The incident's confirmed-down timestamp, which is its identity. */
  incidentId: string;
  /** What actually went wrong, in the owner's words. */
  cause: string;
  /** What was done about it. */
  action: string;
  /** Who wrote it. Recorded, never published. */
  author: string;
  updatedAt: string;
}

/** What a reader gets: the words, without the address of whoever typed them. */
export type PublicNote = Omit<IncidentNote, 'author'>;

export interface NoteLog {
  targetId: string;
  notes: IncidentNote[];
}

export function emptyNotes(targetId: string): NoteLog {
  return { targetId, notes: [] };
}

export function publicNote(note: IncidentNote): PublicNote {
  const { author, ...rest } = note;
  return rest;
}

/** Trim and cap free text. Empty after trimming means "not written". */
export function normalizeText(input: unknown, limit: number): string {
  return String(input ?? '').replace(/\r\n/g, '\n').trim().slice(0, limit);
}

export interface UpsertOptions {
  incidentId: string;
  cause: unknown;
  action: unknown;
  author: string;
  at: string;
}

/**
 * Add or replace a note.
 *
 * A note with nothing in either field is a deletion: the owner clearing the box
 * means the note should go, not that an empty one should be stored.
 */
export function upsertNote(log: NoteLog, options: UpsertOptions): NoteLog {
  const cause = normalizeText(options.cause, CAUSE_LIMIT);
  const action = normalizeText(options.action, ACTION_LIMIT);
  const others = log.notes.filter((note) => note.incidentId !== options.incidentId);

  if (cause === '' && action === '') return { ...log, notes: others };

  const note: IncidentNote = {
    incidentId: options.incidentId,
    cause,
    action,
    author: String(options.author ?? '').trim().toLowerCase(),
    updatedAt: options.at,
  };

  // Newest last, and bounded, like every other log here.
  return { ...log, notes: [...others, note].slice(-NOTE_LIMIT) };
}

export function findNote(log: NoteLog, incidentId: string): IncidentNote | null {
  return log.notes.find((note) => note.incidentId === incidentId) ?? null;
}

/* ---------------- persistence ---------------- */

function keyFor(targetId: string): string {
  return `${KEY_PREFIX}${targetId}`;
}

export async function readNotes(kv: KvClient, targetId: string): Promise<NoteLog> {
  const raw = await kv.get(keyFor(targetId));
  if (raw === null) return emptyNotes(targetId);
  try {
    const parsed = JSON.parse(raw) as Partial<NoteLog>;
    const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    return { targetId, notes: notes.slice(-NOTE_LIMIT) as IncidentNote[] };
  } catch {
    // A corrupt log must not stop the next note being written.
    return emptyNotes(targetId);
  }
}

export async function writeNotes(kv: KvClient, log: NoteLog): Promise<void> {
  await kv.set(keyFor(log.targetId), JSON.stringify(log));
}
