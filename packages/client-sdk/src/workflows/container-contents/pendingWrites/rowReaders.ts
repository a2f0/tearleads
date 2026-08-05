/** Lenient SQL-row readers for the pending-writes diagnostics queries: a
 * missing or empty string reads as null, and a missing count reads as zero,
 * because these rows feed diagnostics rather than verification. */
export function readString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
