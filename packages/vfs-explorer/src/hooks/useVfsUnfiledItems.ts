/**
 * Hook for querying VFS items that are not linked to any folder.
 * Uses SQL-level sorting via JOINs and ORDER BY (no in-memory sort).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { queryUnfiledItems } from '../lib/vfsQuery';
import type { VfsObjectType, VfsSortState } from '../lib/vfsTypes';

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

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function useVfsUnfiledItems(
  sort: VfsSortState = DEFAULT_SORT
): UseVfsUnfiledItemsResult {
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

      const rows = await queryUnfiledItems(db, sort);

      const resultItems: VfsUnfiledItem[] = rows.map((row) => ({
        id: row.id,
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
      console.error('Failed to fetch VFS unfiled items:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, sort, getDatabase]);

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

  // Refetch when sort changes
  const prevSortRef = useRef<VfsSortState>(DEFAULT_SORT);
  useEffect(() => {
    const sortChanged =
      prevSortRef.current.column !== sort.column ||
      prevSortRef.current.direction !== sort.direction;
    prevSortRef.current = sort;

    if (sortChanged && hasFetched && isUnlocked && !loading) {
      fetchItems();
    }
  }, [sort, hasFetched, isUnlocked, loading, fetchItems]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchItems
  };
}
