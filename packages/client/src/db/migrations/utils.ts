import { isRecord } from '@rapid/shared';
import type { DatabaseAdapter } from '../adapters';

/**
 * Check if a table exists in the database.
 * Uses sqlite_master to check for table existence.
 */
export async function tableExists(
  adapter: DatabaseAdapter,
  tableName: string
): Promise<boolean> {
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  return (result?.rows?.length ?? 0) > 0;
}

/**
 * Add a column to a table if it doesn't already exist.
 * Uses PRAGMA table_info to check for column existence.
 */
export async function addColumnIfNotExists(
  adapter: DatabaseAdapter,
  tableName: string,
  columnName: string,
  columnDefinition: string
): Promise<void> {
  try {
    const info = await adapter.execute(`PRAGMA table_info("${tableName}")`);
    const columnExists = info?.rows?.some(
      (col) => isRecord(col) && col['name'] === columnName
    );
    if (!columnExists) {
      await adapter.execute(
        `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`
      );
    }
  } catch (err) {
    // PRAGMA not supported or column already exists, ignore. Log for debugging.
    console.warn(
      `Failed to add column '${columnName}' to '${tableName}':`,
      err
    );
  }
}
