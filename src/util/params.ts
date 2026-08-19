/**
 * Query-parameter parsing.
 *
 * Exists because `Number(null)` and `Number('')` are both `0`, not `NaN` — so the
 * obvious `Number.isFinite(Number(raw))` guard treats a *missing* parameter as
 * the number zero and silently clamps it to the minimum instead of falling back
 * to the default. That bug made `/api/check` use a 1-second timeout whenever the
 * caller omitted `timeout`, which reported every slow-but-healthy site as down.
 */

export interface IntParamOptions {
  min: number;
  max: number;
  fallback: number;
}

/**
 * Read an integer query parameter, clamped to a range.
 *
 * Absent (`null`/`undefined`), blank, and non-numeric values all fall back to
 * `fallback`; anything else is truncated and clamped.
 */
export function parseIntParam(
  raw: string | null | undefined,
  { min, max, fallback }: IntParamOptions,
): number {
  if (raw === null || raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
