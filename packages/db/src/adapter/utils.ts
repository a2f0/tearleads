/**
 * Shared utility functions for database adapters.
 * These are used by all adapters (web, electron, capacitor) for Drizzle sqlite-proxy integration.
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
  // Normalize whitespace to single spaces (avoids polynomial regex on variable whitespace)
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  // Must start with "select "
  if (!lower.startsWith('select ')) return null;

  // Find the top-level " from " boundary (not inside parentheses)
  const afterSelect = 7; // "select ".length
  let depth = 0;
  let fromIndex = -1;

  for (let i = afterSelect; i <= normalized.length - 5; i++) {
    if (normalized[i] === '(') depth++;
    else if (normalized[i] === ')') depth--;
    else if (
      depth === 0 &&
      normalized[i - 1] === ' ' &&
      lower.substring(i, i + 5) === 'from '
    ) {
      fromIndex = i;
      break;
    }
  }

  if (fromIndex === -1) return null;

  const selectClause = normalized.substring(afterSelect, fromIndex).trim();

  // Handle SELECT * case
  if (selectClause === '*') return null;

  const columns: string[] = [];

  // Split by comma, handling nested parentheses (for functions)
  depth = 0;
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

  // Extract the actual column name from each expression
  return columns.map((col) => {
    // Find alias: look for last " as " (case insensitive) to avoid polynomial regex
    const lowerCol = col.toLowerCase();
    const asPos = lowerCol.lastIndexOf(' as ');
    if (asPos !== -1) {
      const alias = col
        .substring(asPos + 4)
        .trim()
        .replace(/"/g, '');
      if (alias && /^[\w$]+$/.test(alias)) {
        return alias;
      }
    }

    // Handle table.column or "table"."column"
    const colParts = col.split('.').filter((part) => part.length > 0);
    const lastPart = colParts[colParts.length - 1];
    if (lastPart === undefined) {
      return col.replace(/"/g, '');
    }
    const trimmed = lastPart.trim();

    // Remove quotes from the final part
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

  // Extract column names from SQL
  let columns = extractSelectColumns(sql);

  // If columns can't be parsed (e.g. SELECT *) and we have rows,
  // derive column order from the keys of the first row.
  const firstRow = rows[0];
  if (!columns && rows.length > 0 && isRecordRow(firstRow)) {
    columns = Object.keys(firstRow);
  }

  if (columns && rows.length > 0) {
    // Convert object rows to array rows in the correct column order
    return rows.map((row) => {
      if (!isRecordRow(row)) {
        return columns.map(() => undefined);
      }
      return rowToArray(row, columns);
    });
  }

  // For non-SELECT queries or if there are no rows, return as-is
  return rows;
}
