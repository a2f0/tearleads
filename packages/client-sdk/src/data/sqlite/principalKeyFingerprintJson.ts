import { type SQLWrapper, sql } from "drizzle-orm";

/** Match the candidate query to its expression index, including corrupt caches. */
export function principalStateFingerprintJson(column: SQLWrapper) {
  return sql<string>`json_extract(CASE WHEN json_valid(${column}) THEN ${column} END, '$.keyFingerprint')`;
}

export function principalCurrentFingerprintJson(column: SQLWrapper) {
  return sql<string>`json_extract(CASE WHEN json_valid(${column}) THEN ${column} END, '$.currentState.keyFingerprint')`;
}
