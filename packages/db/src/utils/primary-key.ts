import type { TableDefinition } from '../schema/types.js';

/**
 * Get primary key columns from a table definition.
 */
export function getPrimaryKeyColumns(table: TableDefinition): string[] {
  return Object.entries(table.columns)
    .filter(([, col]) => col.primaryKey)
    .map(([name]) => name);
}

/**
 * Check if a table has a composite primary key (multiple PK columns).
 */
export function hasCompositePrimaryKey(table: TableDefinition): boolean {
  return getPrimaryKeyColumns(table).length > 1;
}
