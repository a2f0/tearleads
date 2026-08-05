/**
 * Picks the later of two ISO-8601 timestamps, defaulting a fully absent pair
 * to now. ISO-8601 strings order lexicographically, so localeCompare is the
 * comparison, not a display concern.
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

  return left.localeCompare(right) >= 0 ? left : right;
}
