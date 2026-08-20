import type { KvClient } from './kv.js';
import { emptyLog, REPORT_LIMIT, type IncidentLog, type IncidentReport } from './incident.js';

/**
 * Persistence for incident reports.
 *
 * Its own key, for the same reason the rollups have theirs: the dashboard and the
 * office poll `/api/monitors` every minute and have no use for a body excerpt from
 * an outage last March. Reports are only read when somebody opens one.
 *
 * A report with a 400-character excerpt and two snapshots runs to roughly a
 * kilobyte, so thirty of them is well inside a normal value — and thirty outages is
 * a long history for a site worth monitoring at all.
 */

const KEY_PREFIX = 'statusdog:v1:incidents:';

function keyFor(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function readLog(kv: KvClient, targetId: string): Promise<IncidentLog> {
  const raw = await kv.get(keyFor(targetId));
  if (raw === null) return emptyLog(targetId);

  try {
    const parsed = JSON.parse(raw) as Partial<IncidentLog>;
    const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    return { targetId, reports: reports.slice(-REPORT_LIMIT) as IncidentReport[] };
  } catch {
    // A corrupt log must not stop the next incident being recorded.
    return emptyLog(targetId);
  }
}

export async function writeLog(kv: KvClient, log: IncidentLog): Promise<void> {
  await kv.set(keyFor(log.targetId), JSON.stringify(log));
}

export async function clearLog(kv: KvClient, targetId: string): Promise<void> {
  await kv.del(keyFor(targetId));
}
