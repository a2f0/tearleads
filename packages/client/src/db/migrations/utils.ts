import { isRecord } from '@rapid/shared';
import type { DatabaseAdapter } from '../adapters';

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
  } catch {
    // PRAGMA not supported or column already exists, ignore
  }
}
