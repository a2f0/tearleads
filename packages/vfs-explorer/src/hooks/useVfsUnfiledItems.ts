/**
 * Hook for querying VFS items that are not linked to any folder.
 */

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
  vfsFolders,
  vfsLinks,
  vfsRegistry
} from '@rapid/db/sqlite';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VFS_ROOT_ID } from '../constants';
import { useVfsExplorerContext } from '../context';

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

export interface VfsUnfiledItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

export interface UseVfsUnfiledItemsResult {
  items: VfsUnfiledItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

export function useVfsUnfiledItems(): UseVfsUnfiledItemsResult {
  const { databaseState, getDatabase } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [items, setItems] = useState<VfsUnfiledItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all registry items that have no parent link using LEFT JOIN
      // This is more efficient than loading all linked IDs into memory
      // Exclude the VFS root - it's the only item that should have no parent
      const registryRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .leftJoin(vfsLinks, eq(vfsRegistry.id, vfsLinks.childId))
        .where(and(isNull(vfsLinks.childId), ne(vfsRegistry.id, VFS_ROOT_ID)));

      if (registryRows.length === 0) {
        setItems([]);
        setHasFetched(true);
        return;
      }

      // Group by object type for efficient name lookups
      const byType: Record<string, string[]> = {};
      for (const row of registryRows) {
        if (!byType[row.objectType]) {
          byType[row.objectType] = [];
        }
        byType[row.objectType]?.push(row.id);
      }

      // Lookup names from respective tables in parallel
      const nameMap = new Map<string, string>();
      const nameLookups: Promise<void>[] = [];

      // Folders
      if (byType['folder']?.length) {
        nameLookups.push(
          db
            .select({
              id: vfsFolders.id,
              name: vfsFolders.encryptedName
            })
            .from(vfsFolders)
            .where(inArray(vfsFolders.id, byType['folder']))
            .then((folderNameRows) => {
              for (const row of folderNameRows) {
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
            .then((contactRows) => {
              for (const row of contactRows) {
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
            .select({
              id: notes.id,
              title: notes.title
            })
            .from(notes)
            .where(inArray(notes.id, byType['note']))
            .then((noteRows) => {
              for (const row of noteRows) {
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
            .select({
              id: files.id,
              name: files.name
            })
            .from(files)
            .where(inArray(files.id, fileIds))
            .then((fileRows) => {
              for (const row of fileRows) {
                nameMap.set(row.id, row.name);
              }
            })
        );
      }

      // Playlists
      if (byType['playlist']?.length) {
        nameLookups.push(
          db
            .select({
              id: playlists.id,
              name: playlists.encryptedName
            })
            .from(playlists)
            .where(inArray(playlists.id, byType['playlist']))
            .then((playlistRows) => {
              for (const row of playlistRows) {
                nameMap.set(row.id, row.name || 'Unnamed Playlist');
              }
            })
        );
      }

      // Albums
      if (byType['album']?.length) {
        nameLookups.push(
          db
            .select({
              id: albums.id,
              name: albums.encryptedName
            })
            .from(albums)
            .where(inArray(albums.id, byType['album']))
            .then((albumRows) => {
              for (const row of albumRows) {
                nameMap.set(row.id, row.name || 'Unnamed Album');
              }
            })
        );
      }

      // Contact Groups
      if (byType['contactGroup']?.length) {
        nameLookups.push(
          db
            .select({
              id: contactGroups.id,
              name: contactGroups.encryptedName
            })
            .from(contactGroups)
            .where(inArray(contactGroups.id, byType['contactGroup']))
            .then((groupRows) => {
              for (const row of groupRows) {
                nameMap.set(row.id, row.name || 'Unnamed Group');
              }
            })
        );
      }

      // Email Folders
      if (byType['emailFolder']?.length) {
        nameLookups.push(
          db
            .select({
              id: emailFolders.id,
              name: emailFolders.encryptedName
            })
            .from(emailFolders)
            .where(inArray(emailFolders.id, byType['emailFolder']))
            .then((folderRows) => {
              for (const row of folderRows) {
                nameMap.set(row.id, row.name || 'Unnamed Folder');
              }
            })
        );
      }

      // Tags
      if (byType['tag']?.length) {
        nameLookups.push(
          db
            .select({
              id: tags.id,
              name: tags.encryptedName
            })
            .from(tags)
            .where(inArray(tags.id, byType['tag']))
            .then((tagRows) => {
              for (const row of tagRows) {
                nameMap.set(row.id, row.name || 'Unnamed Tag');
              }
            })
        );
      }

      // Emails
      if (byType['email']?.length) {
        nameLookups.push(
          db
            .select({
              id: emails.id,
              subject: emails.encryptedSubject
            })
            .from(emails)
            .where(inArray(emails.id, byType['email']))
            .then((emailRows) => {
              for (const row of emailRows) {
                nameMap.set(row.id, row.subject || '(No Subject)');
              }
            })
        );
      }

      await Promise.all(nameLookups);

      // Build final items list
      const resultItems: VfsUnfiledItem[] = registryRows.map((row) => ({
        id: row.id,
        objectType: row.objectType as VfsObjectType,
        name: nameMap.get(row.id) || 'Unknown',
        createdAt: new Date(row.createdAt)
      }));

      // Sort: folders first, then alphabetically by name
      resultItems.sort((a, b) => {
        if (a.objectType === 'folder' && b.objectType !== 'folder') return -1;
        if (a.objectType !== 'folder' && b.objectType === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });

      setItems(resultItems);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS unfiled items:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, getDatabase]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setItems([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchItems();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchItems]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchItems
  };
}
