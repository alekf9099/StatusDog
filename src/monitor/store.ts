import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FailureReason, ProbeResult } from '../config/types.js';

/** One persisted check. Field names are short because this file grows quickly. */
export interface HistoryRecord {
  /** ISO timestamp. */
  t: string;
  ok: boolean;
  status: number | null;
  /** Response time in milliseconds. */
  ms: number;
  reason: FailureReason | null;
  message: string | null;
}

export interface TargetStats {
  checks: number;
  failures: number;
  /** Percentage of successful checks in the retained history, `null` when empty. */
  uptimePct: number | null;
  avgResponseTimeMs: number | null;
  lastCheckedAt: string | null;
}

interface StoreFile {
  version: 1;
  targets: Record<string, HistoryRecord[]>;
}

/**
 * Append-only ring buffer of check results, optionally mirrored to a JSON file.
 *
 * Writes are debounced and go through a temp file + rename so a crash mid-write
 * cannot leave a truncated history behind.
 */
export class HistoryStore {
  private readonly records = new Map<string, HistoryRecord[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(
    readonly file: string | null = null,
    readonly limit = 500,
    private readonly flushDelayMs = 1_000,
  ) {}

  /** Read the existing history file, if there is one. Missing files are fine. */
  async load(): Promise<void> {
    if (!this.file) return;
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    try {
      const parsed = JSON.parse(raw) as StoreFile;
      for (const [id, list] of Object.entries(parsed.targets ?? {})) {
        if (Array.isArray(list)) this.records.set(id, list.slice(-this.limit));
      }
    } catch {
      // A corrupt history file must not stop monitoring; start fresh instead.
      this.records.clear();
    }
  }

  add(targetId: string, result: ProbeResult): HistoryRecord {
    const record: HistoryRecord = {
      t: result.checkedAt,
      ok: result.ok,
      status: result.status,
      ms: result.responseTimeMs,
      reason: result.reason,
      message: result.message,
    };
    const list = this.records.get(targetId) ?? [];
    list.push(record);
    if (list.length > this.limit) list.splice(0, list.length - this.limit);
    this.records.set(targetId, list);
    this.scheduleFlush();
    return record;
  }

  get(targetId: string, limit = this.limit): HistoryRecord[] {
    const list = this.records.get(targetId) ?? [];
    return limit >= list.length ? [...list] : list.slice(-limit);
  }

  stats(targetId: string): TargetStats {
    const list = this.records.get(targetId) ?? [];
    if (list.length === 0) {
      return { checks: 0, failures: 0, uptimePct: null, avgResponseTimeMs: null, lastCheckedAt: null };
    }
    let failures = 0;
    let totalMs = 0;
    for (const record of list) {
      if (!record.ok) failures++;
      totalMs += record.ms;
    }
    return {
      checks: list.length,
      failures,
      uptimePct: Math.round(((list.length - failures) / list.length) * 10_000) / 100,
      avgResponseTimeMs: Math.round(totalMs / list.length),
      lastCheckedAt: list[list.length - 1]!.t,
    };
  }

  /** Drop every record for a target (or all targets when `targetId` is omitted). */
  clear(targetId?: string): void {
    if (targetId) this.records.delete(targetId);
    else this.records.clear();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (!this.file || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  /** Write pending changes to disk. Safe to call at any time. */
  async flush(): Promise<void> {
    if (!this.file || !this.dirty) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.dirty = false;

    const payload: StoreFile = {
      version: 1,
      targets: Object.fromEntries(this.records),
    };
    const file = this.file;
    // Chain writes so two flushes can never interleave on the same temp file.
    this.writing = this.writing.then(async () => {
      const temp = `${file}.${process.pid}.tmp`;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temp, JSON.stringify(payload), 'utf8');
      await rename(temp, file);
    });
    await this.writing;
  }
}
