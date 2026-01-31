/**
 * Hook for ensuring the VFS root folder exists.
 * The VFS root is the implicit parent of all top-level folders.
 */

import { vfsFolders, vfsRegistry } from '@rapid/db/sqlite';
import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { VFS_ROOT_ID } from '../constants';
import { useVfsExplorerContext } from '../context';

export interface UseEnsureVfsRootResult {
  isReady: boolean;
  isCreating: boolean;
  error: string | null;
  ensureRoot: () => Promise<void>;
}

export function useEnsureVfsRoot(): UseEnsureVfsRootResult {
  const { databaseState, getDatabase } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [isReady, setIsReady] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkedForInstanceRef = useRef<string | null>(null);

  const ensureRoot = useCallback(async () => {
    if (!isUnlocked) return;

    setIsCreating(true);
    setError(null);

    try {
      const db = getDatabase();

      // Check if root already exists
      const existing = await db
        .select({ id: vfsRegistry.id })
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, VFS_ROOT_ID))
        .limit(1);

      if (existing.length > 0) {
        setIsReady(true);
        return;
      }

      // Create the root folder
      const now = new Date();

      await db.transaction(async (tx) => {
        // Insert into vfs_registry
        await tx.insert(vfsRegistry).values({
          id: VFS_ROOT_ID,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          createdAt: now
        });

        // Insert into vfs_folders
        await tx.insert(vfsFolders).values({
          id: VFS_ROOT_ID,
          encryptedName: 'VFS Root'
        });
      });

      setIsReady(true);
    } catch (err) {
      console.error('Failed to ensure VFS root:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }, [isUnlocked, getDatabase]);

  // Auto-ensure root when database is unlocked
  useEffect(() => {
    const needsCheck =
      isUnlocked &&
      !isCreating &&
      !isReady &&
      checkedForInstanceRef.current !== currentInstanceId;

    if (needsCheck) {
      checkedForInstanceRef.current = currentInstanceId;
      ensureRoot();
    }
  }, [isUnlocked, isCreating, isReady, currentInstanceId, ensureRoot]);

  // Reset state when instance changes
  useEffect(() => {
    if (currentInstanceId !== checkedForInstanceRef.current) {
      setIsReady(false);
      setError(null);
    }
  }, [currentInstanceId]);

  return {
    isReady,
    isCreating,
    error,
    ensureRoot
  };
}
