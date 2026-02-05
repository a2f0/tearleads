/**
 * Centralized VFS type definitions.
 */

/**
 * All supported VFS object types.
 */
export type VfsObjectType =
  // Entities
  | 'file'
  | 'photo'
  | 'audio'
  | 'video'
  | 'contact'
  | 'note'
  | 'email'
  // Collections
  | 'folder'
  | 'playlist'
  | 'album'
  | 'contactGroup'
  | 'emailFolder'
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
