/**
 * Hook for querying the contents of a VFS folder.
 */

import { vfsLinks, vfsRegistry } from '@rapid/db/sqlite';
import { eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import {
  fetchItemNames,
  groupByObjectType,
  sortVfsItems,
  type VfsObjectType
} from '../lib';

export type { VfsObjectType };

export interface VfsItem {
  id: string;
  linkId: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

export interface UseVfsFolderContentsResult {
  items: VfsItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

export function useVfsFolderContents(
  folderId: string | null
): UseVfsFolderContentsResult {
  const { databaseState, getDatabase } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [items, setItems] = useState<VfsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForRef = useRef<{
    instanceId: string | null;
    folderId: string | null;
  }>({
    instanceId: null,
    folderId: null
  });

  const fetchContents = useCallback(async () => {
    if (!isUnlocked || !folderId) {
      setItems([]);
      setHasFetched(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all links where this folder is the parent
      const linkRows = await db
        .select({
          linkId: vfsLinks.id,
          childId: vfsLinks.childId
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, folderId));

      if (linkRows.length === 0) {
        setItems([]);
        setHasFetched(true);
        return;
      }

      const childIds = linkRows.map((l) => l.childId);
      const linkMap = new Map(linkRows.map((l) => [l.childId, l.linkId]));

      // Get registry info for all children
      const registryRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .where(inArray(vfsRegistry.id, childIds));

      // Group by object type and fetch names
      const byType = groupByObjectType(registryRows);
      const nameMap = await fetchItemNames(db, byType);

      // Build final items list
      const resultItems: VfsItem[] = registryRows.map((row) => ({
        id: row.id,
        linkId: linkMap.get(row.id) || row.id,
        objectType: row.objectType as VfsObjectType,
        name: nameMap.get(row.id) || 'Unknown',
        createdAt: new Date(row.createdAt)
      }));

      // Sort: folders first, then alphabetically by name
      sortVfsItems(resultItems);

      setItems(resultItems);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS folder contents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, folderId, getDatabase]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched ||
        fetchedForRef.current.instanceId !== currentInstanceId ||
        fetchedForRef.current.folderId !== folderId);

    if (needsFetch) {
      if (
        fetchedForRef.current.instanceId !== currentInstanceId &&
        fetchedForRef.current.instanceId !== null
      ) {
        setItems([]);
        setError(null);
      }

      fetchedForRef.current = { instanceId: currentInstanceId, folderId };

      const timeoutId = setTimeout(() => {
        fetchContents();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    folderId,
    fetchContents
  ]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchContents
  };
}
