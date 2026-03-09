/**
 * Shared SQL batch helpers used by adapters and worker operations.
 */

export const EXECUTE_MANY_SAVEPOINT = 'sp_execute_many';

/**
 * Normalize statement input by trimming, removing empty statements, and
 * stripping trailing semicolons so callers can safely join batches.
 */
export function normalizeSqlStatements(statements: string[]): string[] {
  return statements
    .map((statement) => statement.trim())
    .map((statement) => statement.replace(/;+\s*$/u, ''))
    .filter((statement) => statement.length > 0);
}

/**
 * Build a SQL batch payload joined by semicolons/newlines.
 */
export function buildSqlBatch(statements: string[]): string {
  return normalizeSqlStatements(statements).join(';\n');
}
