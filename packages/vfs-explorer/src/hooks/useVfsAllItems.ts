/**
 * Hook for querying all VFS items in the registry.
 */

import {
  contacts,
  files,
  notes,
  vfsFolders,
  vfsRegistry
} from '@rapid/db/sqlite';
import { inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export type VfsObjectType = 'folder' | 'contact' | 'note' | 'file' | 'photo';

export interface VfsAllItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

export interface UseVfsAllItemsResult {
  items: VfsAllItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

interface UseVfsAllItemsOptions {
  enabled?: boolean;
}

export function useVfsAllItems(
  options: UseVfsAllItemsOptions = {}
): UseVfsAllItemsResult {
  const { enabled = true } = options;
  const { databaseState, getDatabase } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [items, setItems] = useState<VfsAllItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!isUnlocked || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all registry items
      const registryRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry);

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

      // Files and Photos (both use files table)
      const fileTypes = ['file', 'photo'].filter((t) => byType[t]?.length);
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

      await Promise.all(nameLookups);

      // Build final items list
      const resultItems: VfsAllItem[] = registryRows.map((row) => ({
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
      console.error('Failed to fetch VFS all items:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, enabled, getDatabase]);

  useEffect(() => {
    const needsFetch =
      enabled &&
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
  }, [enabled, isUnlocked, loading, hasFetched, currentInstanceId, fetchItems]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchItems
  };
}
