import { expect } from "bun:test";
import { type SQLWrapper, sql } from "drizzle-orm";

// Keep real PostgreSQL fractional milliseconds out of the JS Date conversion.
export function discoveryTimestampValue(value: string) {
  return sql`${value}::timestamp`;
}

// Some listing fixtures model equal publication orders as in migrated data.
export function fixtureDiscoveryOrder(timestamp: SQLWrapper) {
  return sql`(extract(epoch from ${timestamp}) * 1000000)::bigint`;
}

export function expectedDiscoveryId() {
  return expect.stringMatching(/^d1\/[A-Za-z0-9_-]{138}$/u);
}
