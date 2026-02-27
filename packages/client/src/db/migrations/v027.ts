import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v027: Add organization_id to contacts and vfs_registry
 *
 * Adds nullable organization_id column and index to both tables
 * for org-scoped data attribution and filtering.
 */
export const v027: Migration = {
  version: 27,
  description: 'Add organization_id to contacts and vfs_registry',
  up: async (adapter) => {
    await addColumnIfNotExists(adapter, 'contacts', 'organization_id', 'TEXT');
    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "contacts_org_idx" ON "contacts" ("organization_id")'
    );

    await addColumnIfNotExists(
      adapter,
      'vfs_registry',
      'organization_id',
      'TEXT'
    );
    await adapter.execute(
      'CREATE INDEX IF NOT EXISTS "vfs_registry_org_idx" ON "vfs_registry" ("organization_id")'
    );
  }
};
