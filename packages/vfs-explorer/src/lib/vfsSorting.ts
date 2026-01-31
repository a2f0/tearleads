/**
 * Centralized sorting utilities for VFS items.
 */

import type { VfsItemBase } from './vfsTypes';

/**
 * Sorts VFS items: folders first, then alphabetically by name.
 * Mutates the array in place and returns it for chaining.
 */
export function sortVfsItems<T extends VfsItemBase>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (a.objectType === 'folder' && b.objectType !== 'folder') return -1;
    if (a.objectType !== 'folder' && b.objectType === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
}
