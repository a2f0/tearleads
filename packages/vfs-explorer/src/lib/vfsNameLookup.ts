/**
 * Centralized name lookup utilities for VFS items.
 * Fetches display names from respective tables based on object type.
 */

import type { Database } from '@tearleads/db/sqlite';
import {
  aiConversations,
  albums,
  contactGroups,
  contacts,
  emails,
  files,
  notes,
  playlists,
  tags,
  vfsRegistry
} from '@tearleads/db/sqlite';
import { eq, inArray, sql } from 'drizzle-orm';
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
        ${files.name},
        ${notes.title},
        CASE
          WHEN ${contacts.lastName} IS NOT NULL AND ${contacts.lastName} != ''
            THEN ${contacts.firstName} || ' ' || ${contacts.lastName}
          ELSE NULLIF(${contacts.firstName}, '')
        END,
        ${playlists.encryptedName},
        ${albums.encryptedName},
        ${contactGroups.encryptedName},
        ${tags.encryptedName},
        ${emails.encryptedSubject},
        ${aiConversations.encryptedTitle},
        CASE ${vfsRegistry.objectType}
          WHEN 'folder' THEN 'Unnamed Folder'
          WHEN 'file' THEN 'Unnamed File'
          WHEN 'photo' THEN 'Unnamed Photo'
          WHEN 'audio' THEN 'Unnamed Audio'
          WHEN 'video' THEN 'Unnamed Video'
          WHEN 'contact' THEN 'Unnamed Contact'
          WHEN 'note' THEN 'Untitled Note'
          WHEN 'playlist' THEN 'Unnamed Playlist'
          WHEN 'album' THEN 'Unnamed Album'
          WHEN 'contactGroup' THEN 'Unnamed Group'
          WHEN 'tag' THEN 'Unnamed Tag'
          WHEN 'email' THEN '(No Subject)'
          WHEN 'conversation' THEN 'Untitled Conversation'
          ELSE 'Unknown'
        END
      ) as "name"`
    })
    .from(vfsRegistry)
    .leftJoin(files, eq(files.id, vfsRegistry.id))
    .leftJoin(notes, eq(notes.id, vfsRegistry.id))
    .leftJoin(contacts, eq(contacts.id, vfsRegistry.id))
    .leftJoin(playlists, eq(playlists.id, vfsRegistry.id))
    .leftJoin(albums, eq(albums.id, vfsRegistry.id))
    .leftJoin(contactGroups, eq(contactGroups.id, vfsRegistry.id))
    .leftJoin(tags, eq(tags.id, vfsRegistry.id))
    .leftJoin(emails, eq(emails.id, vfsRegistry.id))
    .leftJoin(aiConversations, eq(aiConversations.id, vfsRegistry.id))
    .where(inArray(vfsRegistry.id, ids));

  for (const row of rows) {
    nameMap.set(row.id, row.name || 'Unknown');
  }
  return nameMap;
}
