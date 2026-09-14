/**
 * Picks the later of two ISO-8601 timestamps, defaulting a fully absent pair
 * to now. Canonical ISO-8601 strings order by code unit, so the plain string
 * comparison is the chronological comparison.
 */
export function getLatestTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }
  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}
