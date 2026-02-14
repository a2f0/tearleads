import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v021: Add canonical folder metadata columns to vfs_registry.
 *
 * During folder flattening rollout, folder metadata is read from vfs_registry.
 * These columns must exist on older local databases before read-path cutover is enabled.
 */
export const v021: Migration = {
  version: 21,
  description: 'Add canonical folder metadata columns to vfs_registry',
  up: async (adapter) => {
    await addColumnIfNotExists(
      adapter,
      'vfs_registry',
      'encrypted_name',
      'TEXT'
    );
    await addColumnIfNotExists(adapter, 'vfs_registry', 'icon', 'TEXT');
    await addColumnIfNotExists(adapter, 'vfs_registry', 'view_mode', 'TEXT');
    await addColumnIfNotExists(adapter, 'vfs_registry', 'default_sort', 'TEXT');
    await addColumnIfNotExists(
      adapter,
      'vfs_registry',
      'sort_direction',
      'TEXT'
    );
  }
};
