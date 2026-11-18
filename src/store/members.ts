/**
 * Monitors that belong to a signed-in person.
 *
 * Anybody who signs in with Google can keep a few sites or app APIs on their
 * account: saved on the server, the same on every device, and checked by the
 * scheduler with everything else. Signing in is all it takes — there is no
 * separate sign-up; the first monitor creates the account's record.
 *
 * Three things keep an open door from becoming a problem:
 *
 *   - limits: a handful per person, and a ceiling for everyone together, so one
 *     visitor cannot fill the store or keep the scheduler past its time budget;
 *   - the same address checks as everywhere else (`normalizeCheckUrl`), so no
 *     account can point StatusDog at a private network;
 *   - no email address in the store: each account is keyed by an HMAC of its
 *     address under the session secret, which cannot be turned back into one.
 *
 * Storage costs a fixed handful of commands however many people there are. Each
 * account is one key holding its whole list, plus one index key with the count
 * per account; the scheduler reads the index, then every account in a single
 * MGET, and writes back in a single MSET.
 *
 * These monitors raise no webhook alerts: the webhooks belong to the deployment's
 * owner, who should not be paged about strangers' sites. Their owners see the
 * state in the office and in the warning banner when they open the site.
 */
import crypto from 'node:crypto';
import type { KvClient } from './kv.js';
import type { ProbeResult } from '../config/types.js';
import { normalizeCheckUrl } from '../monitor/target-url.js';

export const MEMBER_LIMIT = 5;
export const TOTAL_LIMIT = 50;
export const MEMBER_HISTORY = 48;
/** Failures in a row before a member's monitor counts as down — as for the roster. */
export const MEMBER_FAILURE_THRESHOLD = 2;
const MAX_NAME = 20;
const INDEX_KEY = 'statusdog:members:index';

export type MemberType = 'web' | 'api';

export interface MemberCheck {
  t: string;
  ok: boolean;
  status: number | null;
  ms: number;
  reason: string | null;
}

export interface MemberMonitor {
  id: string;
  url: string;
  type: MemberType;
  /** Healthy status codes for an API, e.g. `2xx,401`. Websites use the default. */
  expect: string | null;
  name: string | null;
  addedAt: string;
  state: 'up' | 'down' | 'unknown';
  since: string | null;
  consecutiveFailures: number;
  lastResult: {
    checkedAt: string;
    ok: boolean;
    status: number | null;
    responseTimeMs: number;
    reason: string | null;
    message: string | null;
  } | null;
  history: MemberCheck[];
}

export interface MemberDoc {
  v: 1;
  monitors: MemberMonitor[];
}

/** How many monitors each account has, by account key. */
export type MemberIndex = Record<string, number>;

export class MemberError extends Error {
  override name = 'MemberError';
  constructor(
    public readonly code: 'invalid-url' | 'invalid-expect' | 'duplicate' | 'member-limit' | 'total-limit' | 'not-found',
    message: string,
  ) {
    super(message);
  }
}

/** The store key for an account. Not reversible without the session secret. */
export function memberKey(email: string, secret: string): string {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`member:${String(email).trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  return `statusdog:member:${digest}`;
}

export function emptyDoc(): MemberDoc {
  return { v: 1, monitors: [] };
}

/** `200`, `2xx` or `200-299`, comma-separated — the same forms /api/check accepts. */
const STATUS_PART = /^(?:[1-5]\d\d|[1-5]xx|[1-5]\d\d-[1-5]\d\d)$/;

export function normalizeExpect(value: unknown): string | null {
  const parts = String(value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return '2xx';
  return parts.every((part) => STATUS_PART.test(part)) ? parts.join(',') : null;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, MAX_NAME);
}

export function totalOf(index: MemberIndex): number {
  return Object.values(index).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);
}

export interface NewMonitor {
  url: unknown;
  type?: unknown;
  expect?: unknown;
  name?: unknown;
}

/**
 * Add a monitor to an account. Pure: returns the new document and index, and
 * throws a `MemberError` the API can turn into a clear message.
 */
export function addMonitor(
  doc: MemberDoc,
  index: MemberIndex,
  key: string,
  input: NewMonitor,
  now = new Date(),
  id = crypto.randomBytes(6).toString('hex'),
): { doc: MemberDoc; index: MemberIndex; monitor: MemberMonitor } {
  let url: string;
  try {
    url = normalizeCheckUrl(input.url);
  } catch (err) {
    throw new MemberError('invalid-url', (err as Error).message);
  }
  const type: MemberType = input.type === 'api' ? 'api' : 'web';
  const expect = type === 'api' ? normalizeExpect(input.expect) : null;
  if (type === 'api' && expect === null) {
    throw new MemberError('invalid-expect', 'Use status codes like 200, 2xx or 200-299.');
  }
  if (doc.monitors.some((monitor) => monitor.url === url)) {
    throw new MemberError('duplicate', 'That address is already on your account.');
  }
  if (doc.monitors.length >= MEMBER_LIMIT) {
    throw new MemberError('member-limit', `An account can watch up to ${MEMBER_LIMIT}.`);
  }
  if (totalOf(index) >= TOTAL_LIMIT) {
    throw new MemberError('total-limit', `StatusDog is watching its limit of ${TOTAL_LIMIT} for now.`);
  }

  const monitor: MemberMonitor = {
    id,
    url,
    type,
    expect,
    name: cleanName(input.name),
    addedAt: now.toISOString(),
    state: 'unknown',
    since: null,
    consecutiveFailures: 0,
    lastResult: null,
    history: [],
  };
  const monitors = [...doc.monitors, monitor];
  return { doc: { v: 1, monitors }, index: { ...index, [key]: monitors.length }, monitor };
}

export function removeMonitor(
  doc: MemberDoc,
  index: MemberIndex,
  key: string,
  id: string,
): { doc: MemberDoc; index: MemberIndex } {
  const monitors = doc.monitors.filter((monitor) => monitor.id !== id);
  if (monitors.length === doc.monitors.length) throw new MemberError('not-found', 'No such monitor.');
  const next = { ...index };
  if (monitors.length === 0) delete next[key];
  else next[key] = monitors.length;
  return { doc: { v: 1, monitors }, index: next };
}

/**
 * Fold one probe into a monitor: its history, and whether it is up or down. The
 * same rule as the roster's — down after two failures in a row, up on the first
 * success — without the incident reports and alerts that belong to the roster.
 */
export function recordResult(monitor: MemberMonitor, result: ProbeResult): MemberMonitor {
  const failures = result.ok ? 0 : monitor.consecutiveFailures + 1;
  let state = monitor.state;
  if (result.ok) state = 'up';
  else if (failures >= MEMBER_FAILURE_THRESHOLD) state = 'down';
  const changed = state !== monitor.state;
  return {
    ...monitor,
    state,
    since: changed ? result.checkedAt : monitor.since ?? result.checkedAt,
    consecutiveFailures: failures,
    lastResult: {
      checkedAt: result.checkedAt,
      ok: result.ok,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      reason: result.reason,
      message: result.message ? String(result.message).slice(0, 160) : null,
    },
    history: [
      ...monitor.history,
      { t: result.checkedAt, ok: result.ok, status: result.status, ms: result.responseTimeMs, reason: result.reason },
    ].slice(-MEMBER_HISTORY),
  };
}

/** What an account's owner is shown: everything but nothing about other accounts. */
export function publicView(doc: MemberDoc, index: MemberIndex) {
  return {
    limit: MEMBER_LIMIT,
    totalLimit: TOTAL_LIMIT,
    totalUsed: totalOf(index),
    monitors: doc.monitors,
  };
}

/* ---------------- storage ---------------- */

function parseDoc(raw: string | null): MemberDoc {
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as Partial<MemberDoc>;
    return { v: 1, monitors: Array.isArray(parsed.monitors) ? parsed.monitors : [] };
  } catch {
    return emptyDoc();
  }
}

function parseIndex(raw: string | null): MemberIndex {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as MemberIndex) : {};
  } catch {
    return {};
  }
}

async function getMany(kv: KvClient, keys: string[]): Promise<Array<string | null>> {
  if (keys.length === 0) return [];
  if (kv.mget) return kv.mget(keys);
  return Promise.all(keys.map((key) => kv.get(key)));
}

async function setMany(kv: KvClient, entries: Array<[string, string]>): Promise<void> {
  if (entries.length === 0) return;
  if (kv.mset) return kv.mset(entries);
  await Promise.all(entries.map(([key, value]) => kv.set(key, value)));
}

/** One account's list and the index, in one round trip. */
export async function readAccount(kv: KvClient, key: string): Promise<{ doc: MemberDoc; index: MemberIndex }> {
  const [docRaw, indexRaw] = await getMany(kv, [key, INDEX_KEY]);
  return { doc: parseDoc(docRaw ?? null), index: parseIndex(indexRaw ?? null) };
}

export async function readDoc(kv: KvClient, key: string): Promise<MemberDoc> {
  return parseDoc(await kv.get(key));
}

export async function writeAccount(kv: KvClient, key: string, doc: MemberDoc, index: MemberIndex): Promise<void> {
  await setMany(kv, [[key, JSON.stringify(doc)], [INDEX_KEY, JSON.stringify(index)]]);
}

export interface MemberRunSummary {
  accounts: number;
  monitors: number;
  checked: number;
  /** Left for the next run because the time budget ran out. */
  deferred: number;
}

/**
 * Check every member's monitors, within a deadline.
 *
 * `probe` is injected so tests do not touch the network. Probes run a few at a
 * time; once `deadline` passes no new one starts, and the rest wait for the next
 * run rather than holding the scheduler past its limit.
 */
export async function checkMembers(
  kv: KvClient,
  probe: (monitor: MemberMonitor) => Promise<ProbeResult>,
  { deadline, concurrency = 8 }: { deadline: number; concurrency?: number },
): Promise<MemberRunSummary> {
  const index = parseIndex(await kv.get(INDEX_KEY));
  const keys = Object.keys(index).filter((key) => index[key]! > 0);
  if (keys.length === 0) return { accounts: 0, monitors: 0, checked: 0, deferred: 0 };

  const raws = await getMany(kv, keys);
  const docs = raws.map(parseDoc);
  const jobs = docs.flatMap((doc, d) => doc.monitors.map((monitor, m) => ({ d, m, monitor })));

  let checked = 0;
  let next = 0;
  const changed = new Set<number>();
  const worker = async () => {
    while (next < jobs.length && Date.now() < deadline) {
      const job = jobs[next++]!;
      let result: ProbeResult;
      try {
        // Checked again here, not only when added: an address that resolves
        // somewhere private today is refused today.
        normalizeCheckUrl(job.monitor.url);
        result = await probe(job.monitor);
      } catch (err) {
        result = {
          url: job.monitor.url,
          finalUrl: job.monitor.url,
          ok: false,
          status: null,
          responseTimeMs: 0,
          redirects: 0,
          checkedAt: new Date().toISOString(),
          reason: 'network',
          message: (err as Error).message,
          detail: null,
        } as ProbeResult;
      }
      docs[job.d]!.monitors[job.m] = recordResult(job.monitor, result);
      changed.add(job.d);
      checked++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  // Someone may have added or removed a monitor while these ran. Read the lists
  // again and fold the results into them, rather than writing back a stale copy.
  const touched = [...changed];
  const fresh = (await getMany(kv, touched.map((d) => keys[d]!))).map(parseDoc);
  await setMany(kv, touched.map((d, i) => {
    const updated = new Map(docs[d]!.monitors.map((monitor) => [monitor.id, monitor]));
    const merged: MemberDoc = {
      v: 1,
      monitors: fresh[i]!.monitors.map((monitor) => updated.get(monitor.id) ?? monitor),
    };
    return [keys[d]!, JSON.stringify(merged)] as [string, string];
  }));
  return { accounts: keys.length, monitors: jobs.length, checked, deferred: jobs.length - checked };
}
