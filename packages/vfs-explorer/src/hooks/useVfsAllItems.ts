/**
 * Hook for querying all VFS items in the registry.
 * Uses SQL-level sorting via JOINs and ORDER BY (no in-memory sort).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { queryAllItems } from '../lib/vfsQuery';
import type { VfsObjectType, VfsSortState } from '../lib/vfsTypes';

interface VfsAllItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

interface UseVfsAllItemsResult {
  items: VfsAllItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

interface UseVfsAllItemsOptions {
  enabled?: boolean;
  sort?: VfsSortState;
}

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function useVfsAllItems(
  options: UseVfsAllItemsOptions = {}
): UseVfsAllItemsResult {
  const { enabled = true, sort = DEFAULT_SORT } = options;
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

      const rows = await queryAllItems(db, sort);

      const resultItems: VfsAllItem[] = rows.map((row) => ({
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
      console.error('Failed to fetch VFS all items:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, enabled, sort, getDatabase]);

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
