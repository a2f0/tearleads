/**
 * Shared SQL expressions for resolving VFS item display names.
 *
 * Used by vfsQuery.ts, vfsSharesQuery.ts, and vfsNameLookup.ts to avoid
 * duplicating the COALESCE and contact-name logic.
 */

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
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * SQL fragment that builds a contact display name from firstName / lastName.
 * Returns NULL when no contacts row is joined (all columns are NULL).
 */
export function contactNameSql(): SQL {
  return sql`CASE
    WHEN ${contacts.lastName} IS NOT NULL AND ${contacts.lastName} != ''
      THEN ${contacts.firstName} || ' ' || ${contacts.lastName}
    ELSE NULLIF(${contacts.firstName}, '')
  END`;
}

/**
 * COALESCE expression that resolves display names by checking:
 * 1. vfs_registry.encrypted_name (canonical, set for folders/renamed items)
 * 2. Type-specific table columns via LEFT JOINs
 * 3. Fallback placeholder per object type
 *
 * Callers must add the corresponding LEFT JOINs for each type-specific table.
 *
 * Guardrail: folder names must resolve from `vfs_registry.encrypted_name` only.
 * Do not reintroduce `vfs_folders` fallback reads in explorer query paths.
 */
export function nameCoalesce(): SQL<string> {
  return sql<string>`COALESCE(
    NULLIF(${vfsRegistry.encryptedName}, ''),
    ${files.name},
    ${notes.title},
    ${contactNameSql()},
    ${playlists.encryptedName},
    ${albums.encryptedName},
    ${contactGroups.encryptedName},
    ${tags.encryptedName},
    ${emails.encryptedSubject},
    ${aiConversations.encryptedTitle},
    CASE ${vfsRegistry.objectType}
      WHEN 'folder' THEN 'Unnamed Folder'
      WHEN 'emailFolder' THEN 'Unnamed Folder'
      WHEN 'file' THEN 'Unnamed File'
      WHEN 'blob' THEN 'Unnamed Blob'
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
  )`;
}
