import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v009: Add metadata columns to vfs_folders and vfs_links
 *
 * Adds:
 * - icon, view_mode, default_sort, sort_direction columns to vfs_folders
 * - position column to vfs_links for ordered collections
 */
export const v009: Migration = {
  version: 9,
  description: 'Add metadata columns to vfs_folders and vfs_links',
  up: async (adapter) => {
    await addColumnIfNotExists(adapter, 'vfs_folders', 'icon', 'TEXT');
    await addColumnIfNotExists(adapter, 'vfs_folders', 'view_mode', 'TEXT');
    await addColumnIfNotExists(adapter, 'vfs_folders', 'default_sort', 'TEXT');
    await addColumnIfNotExists(
      adapter,
      'vfs_folders',
      'sort_direction',
      'TEXT'
    );
    await addColumnIfNotExists(adapter, 'vfs_links', 'position', 'INTEGER');
  }
};
