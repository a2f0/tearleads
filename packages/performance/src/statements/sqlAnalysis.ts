/**
 * Lightweight normalized-SQL classification for statement capture summaries.
 * Used to tell pure redundant reads from read-after-write refreshes and to
 * count statements issued while holding explicit row or advisory locks.
 */

const writeTargetPattern =
  /\b(?:insert\s+into|update(?:\s+only)?|delete\s+from)\s+(?:(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?)/giu;

const readTargetPattern =
  /\b(?:from|join)\s+(?:(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?)/giu;

const lockPattern =
  /\b(?:for\s+(?:no\s+key\s+)?update|for\s+(?:key\s+)?share|pg_advisory_(?:xact_)?lock|lock\s+table)\b/iu;

const ignoredReadKeywords = new Set([
  "select",
  "lateral",
  "unnest",
  "generate_series",
  "json_array_elements",
  "jsonb_array_elements",
  "values",
]);

function matchTables(
  sql: string,
  pattern: RegExp,
  ignore?: Set<string>,
): string[] {
  const tables = new Set<string>();
  pattern.lastIndex = 0;
  for (
    let match = pattern.exec(sql);
    match !== null;
    match = pattern.exec(sql)
  ) {
    const table = (match[2] ?? "").toLowerCase();
    if (table && !ignore?.has(table)) tables.add(table);
  }
  return [...tables];
}

/** True for read-only SELECT queries (including CTEs that do not mutate). */
export function isReadOnlySelect(normalizedSql: string): boolean {
  const lower = normalizedSql.trimStart().toLowerCase();
  if (
    lower.startsWith("select ") ||
    lower.startsWith("(select ") ||
    lower.startsWith("(((")
  )
    return true;
  if (lower.startsWith("with "))
    return sqlWriteTables(normalizedSql).length === 0;
  return false;
}

/** Tables mutated by an INSERT, UPDATE, or DELETE statement. */
export function sqlWriteTables(normalizedSql: string): readonly string[] {
  return matchTables(normalizedSql, writeTargetPattern);
}

/** Tables read by FROM or JOIN clauses in a query. */
export function sqlReadTables(normalizedSql: string): readonly string[] {
  return matchTables(normalizedSql, readTargetPattern, ignoredReadKeywords);
}

/** True when the statement acquires an explicit row, table, or advisory lock. */
export function isLockStatement(normalizedSql: string): boolean {
  return lockPattern.test(normalizedSql);
}
