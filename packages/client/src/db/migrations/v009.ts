import type { Migration } from './types';

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
    const statements = [
      `ALTER TABLE "vfs_folders" ADD COLUMN "icon" TEXT`,
      `ALTER TABLE "vfs_folders" ADD COLUMN "view_mode" TEXT`,
      `ALTER TABLE "vfs_folders" ADD COLUMN "default_sort" TEXT`,
      `ALTER TABLE "vfs_folders" ADD COLUMN "sort_direction" TEXT`,
      `ALTER TABLE "vfs_links" ADD COLUMN "position" INTEGER`
    ];

    await adapter.executeMany(statements);
  }
};
