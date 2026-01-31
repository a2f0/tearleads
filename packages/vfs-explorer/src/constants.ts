/**
 * Special folder IDs for the VFS explorer.
 */

/**
 * The VFS root folder ID. This is the parent of all top-level folders.
 * Unlike virtual folders, this exists in the database.
 */
export const VFS_ROOT_ID = '__vfs_root__';

/**
 * Virtual folder ID for items that have no parent link.
 * This is a UI-only concept and does not exist in the database.
 */
export const UNFILED_FOLDER_ID = '__unfiled__';

/**
 * Virtual folder ID for viewing all items regardless of folder structure.
 * This is a UI-only concept and does not exist in the database.
 */
export const ALL_ITEMS_FOLDER_ID = '__all__';
