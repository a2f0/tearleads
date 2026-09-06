import { compareIsoTimestamps } from "@tearleads/validators/util";
/**
 * Picks the later of two ISO-8601 timestamps, defaulting a fully absent pair
 * to now. Local JS dates and server discovery dates can have different
 * fractional precision; compare their instants instead of the raw strings.
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

  return compareIsoTimestamps(left, right) >= 0 ? left : right;
}
