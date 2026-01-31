/**
 * Hook for querying all VFS items in the registry.
 */

import { vfsRegistry } from '@rapid/db/sqlite';
import { ne } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VFS_ROOT_ID } from '../constants';
import { useVfsExplorerContext } from '../context';
import {
  fetchItemNames,
  groupByObjectType,
  sortVfsItems,
  type VfsObjectType
} from '../lib';

export type { VfsObjectType };

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

      // Get all registry items, excluding the VFS root
      const registryRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .where(ne(vfsRegistry.id, VFS_ROOT_ID));

      if (registryRows.length === 0) {
        setItems([]);
        setHasFetched(true);
        return;
      }

      // Group by object type and fetch names
      const byType = groupByObjectType(registryRows);
      const nameMap = await fetchItemNames(db, byType);

      // Build final items list
      const resultItems: VfsAllItem[] = registryRows.map((row) => ({
        id: row.id,
        objectType: row.objectType as VfsObjectType,
        name: nameMap.get(row.id) || 'Unknown',
        createdAt: new Date(row.createdAt)
      }));

      // Sort: folders first, then alphabetically by name
      sortVfsItems(resultItems);

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
