/**
 * Shared utility functions for database adapters.
 *
 * These are used by WasmNodeAdapter for Drizzle sqlite-proxy integration.
 * They are maintained locally to keep db-test-utils independent.
 */

/**
 * Type guard to check if a value is a record (object with string keys).
 */
function isRecordRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extract column names from a SELECT statement.
 * Returns column names in the order they appear in the SELECT clause.
 * Handles:
 * - Quoted identifiers like "column_name" and "table"."column"
 * - SQL aliases like "count(*) as count" or "column as alias"
 * - Unquoted identifiers like "users.id"
 *
 * Returns null for SELECT * or non-SELECT statements.
 */
export function extractSelectColumns(sql: string): string[] | null {
  const selectMatch = sql.match(/select\s+(.+?)\s+from\s/is);
  if (!selectMatch || !selectMatch[1]) return null;

  const selectClause = selectMatch[1];

  if (selectClause.trim() === '*') return null;

  const columns: string[] = [];

  let depth = 0;
  let current = '';

  for (const char of selectClause) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    columns.push(current.trim());
  }

  return columns.map((col) => {
    const aliasMatch = col.match(/\s+as\s+("?([\w$]+)"?)\s*$/i);
    if (aliasMatch?.[1]) {
      return aliasMatch[1].replace(/"/g, '');
    }

    const colParts = col.split('.').filter((part) => part.length > 0);
    const lastPart = colParts[colParts.length - 1];
    if (lastPart === undefined) {
      return col.replace(/"/g, '');
    }
    const trimmed = lastPart.trim();

    return trimmed.replace(/"/g, '');
  });
}

/**
 * Convert a row object to an array of values in the column order specified.
 */
export function rowToArray(
  row: Record<string, unknown>,
  columns: string[]
): unknown[] {
  return columns.map((col) => row[col]);
}

/**
 * Convert result rows from object format to array format for Drizzle sqlite-proxy.
 *
 * Drizzle sqlite-proxy expects rows as arrays of values in SELECT column order.
 * SQLite workers/drivers typically return rows as objects with column name keys.
 * This function handles the conversion, including SELECT * queries.
 */
export function convertRowsToArrays(sql: string, rows: unknown[]): unknown[] {
  if (rows.length === 0) {
    return rows;
  }

  let columns = extractSelectColumns(sql);

  const firstRow = rows[0];
  if (!columns && rows.length > 0 && isRecordRow(firstRow)) {
    columns = Object.keys(firstRow);
  }

  if (columns && rows.length > 0) {
    return rows.map((row) => {
      if (!isRecordRow(row)) {
        return columns.map(() => undefined);
      }
      return rowToArray(row, columns);
    });
  }

  return rows;
}
