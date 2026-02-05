/**
 * Hook for querying the contents of a VFS folder.
 * Uses SQL-level sorting via JOINs and ORDER BY (no in-memory sort).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { queryFolderContents } from '../lib/vfsQuery';
import type { VfsObjectType, VfsSortState } from '../lib/vfsTypes';

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

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function useVfsFolderContents(
  folderId: string | null,
  sort: VfsSortState = DEFAULT_SORT
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

      const rows = await queryFolderContents(db, folderId, sort);

      const resultItems: VfsItem[] = rows.map((row) => ({
        id: row.id,
        linkId: row.linkId,
        objectType: row.objectType as VfsObjectType,
        name: row.name,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt
            : new Date(row.createdAt)
      }));

      setItems(resultItems);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS folder contents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, folderId, sort, getDatabase]);

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

  // Refetch when sort changes
  const prevSortRef = useRef<VfsSortState>(DEFAULT_SORT);
  useEffect(() => {
    const sortChanged =
      prevSortRef.current.column !== sort.column ||
      prevSortRef.current.direction !== sort.direction;
    prevSortRef.current = sort;

    if (sortChanged && hasFetched && isUnlocked && !loading) {
      fetchContents();
    }
  }, [sort, hasFetched, isUnlocked, loading, fetchContents]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchContents
  };
}
