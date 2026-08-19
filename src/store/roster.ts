import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig } from '../config/index.js';
import type { ResolvedTarget, StatusDogConfig } from '../config/types.js';

/**
 * The 24/7 monitor roster.
 *
 * It lives in a committed file rather than a database on purpose: the hosted
 * site has no accounts, so a write endpoint would let anyone enlist StatusDog to
 * hammer a URL of their choosing on a schedule. Changing what is monitored means
 * changing the repo, which is reviewable.
 */
export const ROSTER_FILENAME = 'monitors.json';

/**
 * Validate an already-parsed roster.
 *
 * Serverless callers pass the build-time snapshot from `dist/roster.data.js`
 * rather than reading the file, because a bundler cannot see through
 * `readFile(cwd + '/monitors.json')` and would leave it out of the deployment.
 */
export function resolveRoster(
  roster: StatusDogConfig,
  sourcePath: string | null = null,
): ResolvedTarget[] {
  return resolveConfig(roster, sourcePath).targets.filter((target) => target.enabled);
}

/** Read and validate the roster from disk. Used by Node processes, not functions. */
export async function loadRoster(
  file = path.join(process.cwd(), ROSTER_FILENAME),
): Promise<ResolvedTarget[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return resolveRoster(JSON.parse(raw) as StatusDogConfig, file);
}
