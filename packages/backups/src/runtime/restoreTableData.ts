/**
 * Restore table data from backup rows into a database.
 *
 * Uses batch INSERTs (respecting SQLite's 999 bind-parameter limit) with
 * automatic single-row fallback on batch failure.
 */

import type { DatabaseAdapter } from '@tearleads/db/adapter';

const SQLITE_MAX_BIND_PARAMETERS = 999;

function normalizeRestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return value;
}

export async function restoreTableData(
  adapter: DatabaseAdapter,
  tableName: string,
  rows: unknown[]
): Promise<void> {
  if (rows.length === 0) return;

  // Get column names from the first row
  const firstRow = rows[0] as Record<string, unknown>;
  const columns = Object.keys(firstRow);

  if (columns.length === 0) return;

  // Build INSERT statement
  const placeholders = columns.map(() => '?').join(', ');
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  const singleRowSql = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`;
  const maxRowsPerBatch = Math.max(
    1,
    Math.floor(SQLITE_MAX_BIND_PARAMETERS / columns.length)
  );

  for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
    const batchRows = rows.slice(i, i + maxRowsPerBatch);
    if (batchRows.length === 0) {
      continue;
    }

    const batchSql = `INSERT INTO "${tableName}" (${columnList}) VALUES ${batchRows
      .map(() => `(${placeholders})`)
      .join(', ')}`;
    const batchValues = batchRows.flatMap((rawRow) => {
      const rowData = rawRow as Record<string, unknown>;
      return columns.map((columnName) =>
        normalizeRestoreValue(rowData[columnName])
      );
    });

    try {
      await adapter.execute(batchSql, batchValues);
      continue;
    } catch {
      // Fallback preserves previous best-effort semantics if a batch fails.
    }

    for (const rawRow of batchRows) {
      const rowData = rawRow as Record<string, unknown>;
      const values = columns.map((columnName) =>
        normalizeRestoreValue(rowData[columnName])
      );

      try {
        await adapter.execute(singleRowSql, values);
      } catch (err) {
        // Log but continue - some rows may conflict with existing data
        console.warn(`Failed to insert row into ${tableName}:`, err);
      }
    }
  }
}
