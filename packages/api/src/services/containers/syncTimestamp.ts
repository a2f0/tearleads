import { normalizeIsoTimestamp } from "@tearleads/validators/util";
import { type SQL, sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../utils/sqlDialect";

/** Keep PostgreSQL microseconds across the wire and subsequent keyset reads. */
export function normalizeSyncTimestamp(value: string): string | null {
  const timestamp = normalizeIsoTimestamp(value);
  return timestamp?.replace(/(\.\d{3})000Z$/u, "$1Z") ?? null;
}

export function readSyncTimestamp(value: unknown): string {
  // SQLite's timestamp columns contain integer milliseconds; PostgreSQL's
  // expression below produces UTC text without passing through a Date decoder.
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
    ? sql`${expression}`
    : sql`to_char(${expression}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  return timestamp.mapWith(readSyncTimestamp);
}
