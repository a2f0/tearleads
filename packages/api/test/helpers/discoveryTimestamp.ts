import { sql } from "drizzle-orm";

// Keep real PostgreSQL fractional milliseconds out of the JS Date conversion.
export function discoveryTimestampValue(value: string) {
  return sql`${value}::timestamp`;
}
