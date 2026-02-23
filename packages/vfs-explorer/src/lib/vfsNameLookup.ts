/**
 * Centralized name lookup utilities for VFS items.
 * Fetches display names from respective tables based on object type.
 */

import type { Database } from '@tearleads/db/sqlite';
import { vfsRegistry } from '@tearleads/db/sqlite';
import { inArray, sql } from 'drizzle-orm';
import type { VfsRegistryRow } from './vfsTypes';

/**
 * Groups registry rows by object type for batch name lookups.
 */
export function groupByObjectType(
  rows: Pick<VfsRegistryRow, 'id' | 'objectType'>[]
): Record<string, string[]> {
  const byType: Record<string, string[]> = {};
  for (const row of rows) {
    if (!byType[row.objectType]) {
      byType[row.objectType] = [];
    }
    byType[row.objectType]?.push(row.id);
  }
  return byType;
}

/**
 * Fetches display names for all VFS items in the given type groups.
 * Returns a Map from item ID to display name.
 */
export async function fetchItemNames(
  db: Database,
  byType: Record<string, string[]>
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  const ids = Array.from(new Set(Object.values(byType).flat()));
  if (ids.length === 0) {
    return nameMap;
  }

  const rows = await db
    .select({
      id: vfsRegistry.id,
      name: sql<string>`COALESCE(
        NULLIF(${vfsRegistry.encryptedName}, ''),
        CASE WHEN ${vfsRegistry.objectType} = 'folder' THEN 'Unnamed Folder' END,
        CASE WHEN ${vfsRegistry.objectType} = 'file' THEN 'Unnamed File' END,
        CASE WHEN ${vfsRegistry.objectType} = 'photo' THEN 'Unnamed Photo' END,
        CASE WHEN ${vfsRegistry.objectType} = 'audio' THEN 'Unnamed Audio' END,
        CASE WHEN ${vfsRegistry.objectType} = 'video' THEN 'Unnamed Video' END,
        CASE WHEN ${vfsRegistry.objectType} = 'contact' THEN 'Unnamed Contact' END,
        CASE WHEN ${vfsRegistry.objectType} = 'note' THEN 'Untitled Note' END,
        CASE WHEN ${vfsRegistry.objectType} = 'playlist' THEN 'Unnamed Playlist' END,
        CASE WHEN ${vfsRegistry.objectType} = 'album' THEN 'Unnamed Album' END,
        CASE WHEN ${vfsRegistry.objectType} = 'contactGroup' THEN 'Unnamed Group' END,
        CASE WHEN ${vfsRegistry.objectType} = 'emailFolder' THEN 'Unnamed Folder' END,
        CASE WHEN ${vfsRegistry.objectType} = 'tag' THEN 'Unnamed Tag' END,
        CASE WHEN ${vfsRegistry.objectType} = 'email' THEN '(No Subject)' END,
        'Unknown'
      ) as "name"`
    })
    .from(vfsRegistry)
    .where(inArray(vfsRegistry.id, ids));

  for (const row of rows) {
    nameMap.set(row.id, row.name || 'Unknown');
  }
  return nameMap;
}
