import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * SQLite's historical default `SQLITE_MAX_VARIABLE_NUMBER`. Some hosts raise
 * it, but the SDK runs on several SQLite builds, so every statement it batches
 * stays within this budget.
 */
export const SQLITE_BOUND_VARIABLE_BUDGET = 999;

/**
 * Rows (or list entries) one statement may carry when each binds
 * `variablesPerRow` values on top of `fixedVariables` shared ones.
 */
export function sqliteRowsPerStatement(
  variablesPerRow: number,
  fixedVariables = 0,
): number {
  const rows = Math.floor(
    (SQLITE_BOUND_VARIABLE_BUDGET - fixedVariables) / variablesPerRow,
  );
  if (
    !Number.isInteger(variablesPerRow) ||
    variablesPerRow < 1 ||
    !Number.isInteger(fixedVariables) ||
    fixedVariables < 0 ||
    rows < 1
  ) {
    throw new Error("SQLite statement cannot fit its bound variables");
  }
  return rows;
}

/**
 * Rows per multi-row INSERT into `table`. Every column may bind one value,
 * including explicit nulls, so the column count is the per-row ceiling.
 */
export function sqliteInsertBatchSize(table: SQLiteTable): number {
  return sqliteRowsPerStatement(Object.keys(getTableColumns(table)).length);
}

// Keep bulk inserts, IN predicates, and expanded pair predicates comfortably
// below SQLite's common 999-bind and expression-depth limits. Some queued rows
// consume more than ten binds each, so one conservative size covers every
// reset statement.
export const REMOTE_RESET_SQL_BATCH_SIZE = 50;

export function remoteResetBatches<T>(
  values: readonly T[],
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  for (
    let offset = 0;
    offset < values.length;
    offset += REMOTE_RESET_SQL_BATCH_SIZE
  ) {
    batches.push(values.slice(offset, offset + REMOTE_RESET_SQL_BATCH_SIZE));
  }
  return batches;
}
