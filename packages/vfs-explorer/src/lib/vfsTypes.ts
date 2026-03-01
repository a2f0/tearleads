/**
 * Centralized VFS type definitions.
 */

/**
 * All supported VFS object types.
 */
export type VfsObjectType =
  // Entities
  | 'file'
  | 'blob'
  | 'photo'
  | 'audio'
  | 'video'
  | 'contact'
  | 'note'
  | 'email'
  | 'mlsMessage'
  | 'conversation'
  // Collections
  | 'folder'
  | 'emailFolder'
  | 'playlist'
  | 'album'
  | 'contactGroup'
  | 'tag';

/**
 * Base interface for VFS items returned by query hooks.
 */
export interface VfsItemBase {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

/**
 * Registry row shape from database queries.
 */
export interface VfsRegistryRow {
  id: string;
  objectType: string;
  createdAt: Date;
}

/**
 * Sortable columns in the VFS explorer.
 */
export type VfsSortColumn = 'name' | 'objectType' | 'createdAt';

/**
 * Sort direction.
 */
export type VfsSortDirection = 'asc' | 'desc';

/**
 * Sort state for the VFS explorer.
 */
export interface VfsSortState {
  column: VfsSortColumn | null;
  direction: VfsSortDirection | null;
}

/**
 * Display item shape used in the details panel.
 * Alias for VfsItemBase - shared between folder contents and unfiled items.
 */
export type DisplayItem = VfsItemBase;

/**
 * View mode for the VFS explorer (list or table view).
 */
export type VfsViewMode = 'list' | 'table';

/**
 * Item data passed to onItemOpen callback.
 */
export type VfsOpenItem = DisplayItem;
