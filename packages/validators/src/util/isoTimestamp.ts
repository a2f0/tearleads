/** Normalize an explicit-zone ISO timestamp to UTC with six fractional digits. */
export function normalizeIsoTimestamp(value: string): string | null {
  const match =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (!match) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const remainder = (match[1] ?? "").slice(3).padEnd(3, "0");
  return `${date.toISOString().slice(0, -1)}${remainder}Z`;
}

/** Compare instants, including mixed JS millisecond / PostgreSQL microsecond precision. */
export function compareIsoTimestamps(left: string, right: string): number {
  const leftKey = normalizeIsoTimestamp(left);
  const rightKey = normalizeIsoTimestamp(right);
  if (leftKey === null || rightKey === null)
    throw new Error("Invalid ISO timestamp");
  return leftKey.localeCompare(rightKey);
}
