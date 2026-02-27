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

/**
 * Virtual folder ID for viewing items the current user has shared with others.
 * This is a UI-only concept and does not exist in the database.
 */
export const SHARED_BY_ME_FOLDER_ID = '__shared_by_me__';

/**
 * Virtual folder ID for viewing items shared with the current user.
 * This is a UI-only concept and does not exist in the database.
 */
export const SHARED_WITH_ME_FOLDER_ID = '__shared_with_me__';

/**
 * Virtual folder ID for viewing items marked as deleted.
 * This is a UI-only concept and does not exist in the database.
 */
export const TRASH_FOLDER_ID = '__trash__';

/**
 * Sentinel error value indicating the user is not logged in.
 * Used by shared-items hooks to signal that authentication is required,
 * allowing the UI to render a login fallback instead of a plain error message.
 */
export const NOT_LOGGED_IN_ERROR = '__not_logged_in__';
