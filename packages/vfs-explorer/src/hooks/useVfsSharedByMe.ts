/**
 * Hook for querying VFS items that the current user has shared with others.
 * Uses SQL-level sorting via JOINs and ORDER BY (no in-memory sort).
 */

import type { VfsPermissionLevel, VfsShareType } from '@tearleads/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { querySharedByMe } from '../lib/vfsSharesQuery';
import type { VfsObjectType, VfsSortState } from '../lib/vfsTypes';

/** Convert a string or Date to a Date object. */
function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Convert a nullable string or Date to a nullable Date object. */
function toNullableDate(value: string | Date | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

interface VfsSharedByMeItem {
  id: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
  shareId: string;
  targetId: string;
  targetName: string;
  shareType: VfsShareType;
  permissionLevel: VfsPermissionLevel;
  sharedAt: Date;
  expiresAt: Date | null;
}

interface UseVfsSharedByMeResult {
  items: VfsSharedByMeItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

interface UseVfsSharedByMeOptions {
  enabled?: boolean;
  sort?: VfsSortState;
}

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

export function useVfsSharedByMe(
  options: UseVfsSharedByMeOptions = {}
): UseVfsSharedByMeResult {
  const { enabled = true, sort = DEFAULT_SORT } = options;
  const { databaseState, getDatabase, auth } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [items, setItems] = useState<VfsSharedByMeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!isUnlocked || !enabled) return;

    const storedAuth = auth.readStoredAuth();
    const currentUserId = storedAuth?.user?.id;
    if (!currentUserId) {
      setError('Not logged in');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const rows = await querySharedByMe(db, currentUserId, sort);

      const resultItems: VfsSharedByMeItem[] = rows.map((row) => ({
        id: row.id,
        objectType: row.objectType as VfsObjectType,
        name: row.name,
        createdAt: toDate(row.createdAt),
        shareId: row.shareId,
        targetId: row.targetId,
        targetName: row.targetName,
        shareType: row.shareType as VfsShareType,
        permissionLevel: row.permissionLevel as VfsPermissionLevel,
        sharedAt: toDate(row.sharedAt),
        expiresAt: toNullableDate(row.expiresAt)
      }));

      setItems(resultItems);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS shared by me items:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, enabled, sort, getDatabase, auth]);

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
