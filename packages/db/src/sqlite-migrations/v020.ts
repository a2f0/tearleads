import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v020: Add parent_id column to health_exercises
 *
 * Supports hierarchical exercise categories (e.g., Pull-Up -> Wide Grip Pull-Up).
 * Note: SQLite doesn't enforce foreign key constraints on columns added via ALTER TABLE,
 * so we add the column without the constraint. The constraint is defined in the schema
 * for documentation and new databases.
 */
export const v020: Migration = {
  version: 20,
  description: 'Add parent_id column to health_exercises',
  up: async (adapter) => {
    await addColumnIfNotExists(
      adapter,
      'health_exercises',
      'parent_id',
      'TEXT'
    );

    await adapter.execute(
      `CREATE INDEX IF NOT EXISTS "health_exercises_parent_idx" ON "health_exercises" ("parent_id")`
    );
  }
};
