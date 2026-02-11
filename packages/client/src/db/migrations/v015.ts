import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v015: Add soft-delete support for tags
 *
 * Adds a `deleted` flag to tags so Classic can soft-delete and restore tags.
 */
export const v015: Migration = {
  version: 15,
  description: 'Add deleted column to tags',
  up: async (adapter) => {
    await addColumnIfNotExists(
      adapter,
      'tags',
      'deleted',
      'INTEGER DEFAULT 0 NOT NULL'
    );
    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "tags_deleted_idx" ON "tags" ("deleted")'
    );
  }
};
