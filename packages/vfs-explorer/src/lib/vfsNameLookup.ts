/**
 * Centralized name lookup utilities for VFS items.
 * Fetches display names from respective tables based on object type.
 */

import type { Database } from '@tearleads/db/sqlite';
import {
  albums,
  contactGroups,
  contacts,
  emailFolders,
  emails,
  files,
  notes,
  playlists,
  tags,
  vfsRegistry
} from '@tearleads/db/sqlite';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
  const nameLookups: Promise<void>[] = [];

  // Folders
  if (byType['folder']?.length) {
    // Guardrail: folder display names come from canonical vfs_registry metadata.
    // Legacy vfs_folders values must not be read in lookup paths.
    nameLookups.push(
      db
        .select({
          id: vfsRegistry.id,
          name: sql<string>`COALESCE(
            NULLIF(${vfsRegistry.encryptedName}, ''),
            'Unnamed Folder'
          ) as "name"`
        })
        .from(vfsRegistry)
        .where(
          and(
            eq(vfsRegistry.objectType, 'folder'),
            inArray(vfsRegistry.id, byType['folder'])
          )
        )
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Folder');
          }
        })
    );
  }

  // Contacts
  if (byType['contact']?.length) {
    nameLookups.push(
      db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName
        })
        .from(contacts)
        .where(inArray(contacts.id, byType['contact']))
        .then((rows) => {
          for (const row of rows) {
            const name = row.lastName
              ? `${row.firstName} ${row.lastName}`
              : row.firstName;
            nameMap.set(row.id, name);
          }
        })
    );
  }

  // Notes
  if (byType['note']?.length) {
    nameLookups.push(
      db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(inArray(notes.id, byType['note']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.title);
          }
        })
    );
  }

  // Files, Photos, Audio, Video (all use files table)
  const fileTypes = ['file', 'photo', 'audio', 'video'].filter(
    (t) => byType[t]?.length
  );
  if (fileTypes.length > 0) {
    const fileIds = fileTypes.flatMap((t) => byType[t] || []);
    nameLookups.push(
      db
        .select({ id: files.id, name: files.name })
        .from(files)
        .where(inArray(files.id, fileIds))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name);
          }
        })
    );
  }

  // Playlists
  if (byType['playlist']?.length) {
    nameLookups.push(
      db
        .select({ id: playlists.id, name: playlists.encryptedName })
        .from(playlists)
        .where(inArray(playlists.id, byType['playlist']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Playlist');
          }
        })
    );
  }

  // Albums
  if (byType['album']?.length) {
    nameLookups.push(
      db
        .select({ id: albums.id, name: albums.encryptedName })
        .from(albums)
        .where(inArray(albums.id, byType['album']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Album');
          }
        })
    );
  }

  // Contact Groups
  if (byType['contactGroup']?.length) {
    nameLookups.push(
      db
        .select({ id: contactGroups.id, name: contactGroups.encryptedName })
        .from(contactGroups)
        .where(inArray(contactGroups.id, byType['contactGroup']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Group');
          }
        })
    );
  }

  // Email Folders
  if (byType['emailFolder']?.length) {
    nameLookups.push(
      db
        .select({ id: emailFolders.id, name: emailFolders.encryptedName })
        .from(emailFolders)
        .where(inArray(emailFolders.id, byType['emailFolder']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Folder');
          }
        })
    );
  }

  // Tags
  if (byType['tag']?.length) {
    nameLookups.push(
      db
        .select({ id: tags.id, name: tags.encryptedName })
        .from(tags)
        .where(inArray(tags.id, byType['tag']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.name || 'Unnamed Tag');
          }
        })
    );
  }

  // Emails
  if (byType['email']?.length) {
    nameLookups.push(
      db
        .select({ id: emails.id, subject: emails.encryptedSubject })
        .from(emails)
        .where(inArray(emails.id, byType['email']))
        .then((rows) => {
          for (const row of rows) {
            nameMap.set(row.id, row.subject || '(No Subject)');
          }
        })
    );
  }

  await Promise.all(nameLookups);
  return nameMap;
}
