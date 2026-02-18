/**
 * Hook for deleting VFS folders.
 * When a folder is deleted:
 * - The folder is removed from the registry
 * - All links where this folder is the parent are deleted (children become unfiled)
 * - All links where this folder is the child are deleted (removes from parent)
 * - The folder name entry is deleted
 * All of the above is handled by database cascades.
 */

import { vfsRegistry } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface UseDeleteVfsFolderResult {
  deleteFolder: (folderId: string) => Promise<void>;
  isDeleting: boolean;
  error: string | null;
}

export function useDeleteVfsFolder(): UseDeleteVfsFolderResult {
  const { getDatabase } = useVfsExplorerContext();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteFolder = useCallback(
    async (folderId: string): Promise<void> => {
      if (!folderId) {
        throw new Error('Folder ID is required');
      }

      setIsDeleting(true);
      setError(null);

      try {
        const db = getDatabase();

        await db.transaction(async (tx) => {
          const candidateRows = await tx
            .select({ objectType: vfsRegistry.objectType })
            .from(vfsRegistry)
            .where(eq(vfsRegistry.id, folderId))
            .limit(1);
          const candidate = candidateRows[0];
          if (!candidate) {
            throw new Error('Folder not found');
          }

          // Guardrail: folder-delete path must never remove non-folder objects.
          if (candidate.objectType !== 'folder') {
            throw new Error('Refusing to delete non-folder VFS item');
          }

          // Delete from vfs_registry; cascades remove links and associated objects.
          await tx.delete(vfsRegistry).where(eq(vfsRegistry.id, folderId));
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [getDatabase]
  );

  return {
    deleteFolder,
    isDeleting,
    error
  };
}
