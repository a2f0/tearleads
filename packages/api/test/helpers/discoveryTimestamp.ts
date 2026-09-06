import { sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../../src/utils/sqlDialect";

// Keep real PostgreSQL fractional milliseconds out of the JS Date conversion.
// SQLite stores integer milliseconds; the same fixture then exercises id ties.
export function discoveryTimestamp(value: string): string {
  return isSqliteApiDatabase() ? new Date(value).toISOString() : value;
}

export function discoveryTimestampValue(value: string) {
  return isSqliteApiDatabase() ? new Date(value) : sql`${value}::timestamp`;
}
