/**
 * Hook for renaming VFS folders.
 */

import { vfsRegistry } from '@tearleads/db/sqlite';
import { and, eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface UseRenameVfsFolderResult {
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  isRenaming: boolean;
  error: string | null;
}

export function useRenameVfsFolder(): UseRenameVfsFolderResult {
  const { getDatabase } = useVfsExplorerContext();
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameFolder = useCallback(
    async (folderId: string, newName: string): Promise<void> => {
      const trimmedName = newName.trim();
      if (!trimmedName) {
        throw new Error('Folder name is required');
      }
      if (!folderId) {
        throw new Error('Folder ID is required');
      }

      setIsRenaming(true);
      setError(null);

      try {
        const db = getDatabase();

        await db.transaction(async (tx) => {
          // Guardrail: folder metadata is canonical on vfs_registry.
          await tx
            .update(vfsRegistry)
            .set({ encryptedName: trimmedName })
            .where(
              and(
                eq(vfsRegistry.id, folderId),
                eq(vfsRegistry.objectType, 'folder')
              )
            );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsRenaming(false);
      }
    },
    [getDatabase]
  );

  return {
    renameFolder,
    isRenaming,
    error
  };
}
