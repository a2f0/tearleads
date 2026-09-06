import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

/** Keep PostgreSQL microseconds in discovery ordering and opaque cursors. */
export function normalizeSyncTimestamp(value: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0");
  // Date parses only milliseconds; retain the remaining digits separately.
  const date = new Date(`${match[1]}.${fraction.slice(0, 3)}${match[3]}`);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  const remainder = fraction.slice(3);
  return remainder === "000" ? iso : `${iso.slice(0, -1)}${remainder}Z`;
}

export function readSyncTimestamp(value: unknown): string {
  // SQLite stores integer milliseconds; PostgreSQL SELECT produces UTC text.
  const timestamp =
    typeof value === "number"
      ? new Date(value).toISOString()
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const normalized = normalizeSyncTimestamp(timestamp);
  if (normalized === null) throw new Error("Invalid discovery timestamp");
  return normalized;
}

export function syncTimestampExpression(expression: SQL): SQL<string> {
  const timestamp = isSqliteApiDatabase()
    ? expression
    : sql`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return timestamp.mapWith(readSyncTimestamp);
}

/** Inputs are normalized UTC discovery timestamps with 3 or 6 fractional digits. */
export function compareSyncTimestamps(left: string, right: string): number {
  return left
    .slice(0, -1)
    .padEnd(26, "0")
    .localeCompare(right.slice(0, -1).padEnd(26, "0"));
}

/** Entity timestamps use the same milliseconds as mutation/read-model responses. */
export function syncItemTimestamp(timestamp: string): string {
  return `${timestamp.slice(0, 23)}Z`;
}
