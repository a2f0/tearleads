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

function isSqlWhitespace(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === ' ' ||
    char === '\n' ||
    char === '\r' ||
    char === '\t' ||
    char === '\f'
  );
}

function stripDoubleQuotes(value: string): string {
  let stripped = '';
  for (const char of value) {
    if (char !== '"') {
      stripped += char;
    }
  }
  return stripped;
}

function isFromKeywordAt(source: string, index: number): boolean {
  if (source.slice(index, index + 4).toLowerCase() !== 'from') {
    return false;
  }

  return (
    isSqlWhitespace(source[index - 1]) && isSqlWhitespace(source[index + 4])
  );
}

function findSelectClause(sql: string): string | null {
  const trimmed = sql.trimStart();
  if (!trimmed.toLowerCase().startsWith('select')) {
    return null;
  }

  let clauseStart = 'select'.length;
  while (
    clauseStart < trimmed.length &&
    isSqlWhitespace(trimmed[clauseStart])
  ) {
    clauseStart += 1;
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = clauseStart; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? '';

    if (char === "'" && !inDoubleQuote) {
      const next = trimmed[index + 1] ?? '';
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')' && depth > 0) {
      depth -= 1;
      continue;
    }

    if (depth === 0 && (char === 'f' || char === 'F')) {
      if (isFromKeywordAt(trimmed, index)) {
        return trimmed.slice(clauseStart, index).trim();
      }
    }
  }

  return null;
}

function splitSelectColumns(selectClause: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let current = '';

  for (let index = 0; index < selectClause.length; index += 1) {
    const char = selectClause[index] ?? '';

    if (char === "'" && !inDoubleQuote) {
      const next = selectClause[index + 1] ?? '';
      if (inSingleQuote && next === "'") {
        current += "''";
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')' && depth > 0) {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        const normalized = current.trim();
        if (normalized.length > 0) {
          columns.push(normalized);
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    columns.push(tail);
  }

  return columns;
}

function findAsKeywordIndex(column: string): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let match = -1;

  for (let index = 0; index < column.length - 1; index += 1) {
    const char = column[index] ?? '';

    if (char === "'" && !inDoubleQuote) {
      const next = column[index + 1] ?? '';
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')' && depth > 0) {
      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    if (
      (char === 'a' || char === 'A') &&
      (column[index + 1] === 's' || column[index + 1] === 'S') &&
      isSqlWhitespace(column[index - 1]) &&
      isSqlWhitespace(column[index + 2])
    ) {
      match = index;
    }
  }

  return match;
}

function normalizeColumnName(column: string): string {
  const asIndex = findAsKeywordIndex(column);
  if (asIndex >= 0) {
    const alias = column.slice(asIndex + 2).trim();
    if (alias.length > 0) {
      return stripDoubleQuotes(alias);
    }
  }

  const lastDot = column.lastIndexOf('.');
  const nameCandidate = lastDot >= 0 ? column.slice(lastDot + 1) : column;
  return stripDoubleQuotes(nameCandidate.trim());
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
  const selectClause = findSelectClause(sql);
  if (!selectClause) return null;

  if (selectClause.trim() === '*') return null;

  return splitSelectColumns(selectClause).map(normalizeColumnName);
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
