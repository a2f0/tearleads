import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

/** Keep PostgreSQL microseconds across the wire and subsequent keyset reads. */
export function normalizeSyncTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/u.exec(value)?.[1] ?? "";
  if (fraction.length > 6) return null;
  const remainder = fraction.slice(3).padEnd(3, "0");
  const iso = date.toISOString();
  return remainder === "000" ? iso : `${iso.slice(0, -1)}${remainder}Z`;
}

export function readSyncTimestamp(value: unknown): string {
  // SQLite's timestamp columns contain integer milliseconds; PostgreSQL's
  // expression below produces UTC text without passing through a Date decoder.
  const timestamp =
    typeof value === "number" ? new Date(value).toISOString() : String(value);
  const normalized = normalizeSyncTimestamp(timestamp);
  if (normalized === null) throw new Error("Invalid discovery timestamp");
  return normalized;
}

export function syncTimestampExpression(expression: SQL): SQL<string> {
  const timestamp = isSqliteApiDatabase()
    ? sql`${expression}`
    : sql`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return timestamp.mapWith(readSyncTimestamp);
}

export function compareSyncTimestamps(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds !== 0) return milliseconds;
  const remainder = (value: string) =>
    Number(/\.(\d+)Z$/u.exec(value)?.[1]?.padEnd(6, "0").slice(3) ?? 0);
  return remainder(left) - remainder(right);
}
