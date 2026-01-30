/**
 * Hook for creating VFS folders.
 */

import { vfsFolders, vfsLinks, vfsRegistry } from '@rapid/db/sqlite';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface CreateFolderResult {
  id: string;
  name: string;
}

export interface UseCreateVfsFolderResult {
  createFolder: (
    name: string,
    parentId?: string | null
  ) => Promise<CreateFolderResult>;
  isCreating: boolean;
  error: string | null;
}

export function useCreateVfsFolder(): UseCreateVfsFolderResult {
  const { getDatabase, vfsKeys, auth, featureFlags, vfsApi } =
    useVfsExplorerContext();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createFolder = useCallback(
    async (
      name: string,
      parentId?: string | null
    ): Promise<CreateFolderResult> => {
      if (!name.trim()) {
        throw new Error('Folder name is required');
      }

      setIsCreating(true);
      setError(null);

      try {
        const db = getDatabase();
        const id = crypto.randomUUID();
        const now = new Date();

        // Get current user ID
        const authData = auth.readStoredAuth();

        let encryptedSessionKey: string | null = null;
        if (auth.isLoggedIn()) {
          try {
            const sessionKey = vfsKeys.generateSessionKey();
            encryptedSessionKey = await vfsKeys.wrapSessionKey(sessionKey);
          } catch (err) {
            console.warn('Failed to wrap folder session key:', err);
          }
        }

        // Use transaction to ensure atomicity
        await db.transaction(async (tx) => {
          // Insert into local vfs_registry
          await tx.insert(vfsRegistry).values({
            id,
            objectType: 'folder',
            ownerId: authData.user?.id ?? null,
            encryptedSessionKey,
            createdAt: now
          });

          // Insert into local vfs_folders
          await tx.insert(vfsFolders).values({
            id,
            encryptedName: name.trim()
          });

          // If parent folder specified and we have an encrypted key, create link
          if (parentId && encryptedSessionKey) {
            const linkId = crypto.randomUUID();
            await tx.insert(vfsLinks).values({
              id: linkId,
              parentId,
              childId: id,
              wrappedSessionKey: encryptedSessionKey,
              createdAt: now
            });
          }
        });

        if (
          auth.isLoggedIn() &&
          featureFlags.getFeatureFlagValue('vfsServerRegistration') &&
          encryptedSessionKey
        ) {
          try {
            await vfsApi.register({
              id,
              objectType: 'folder',
              encryptedSessionKey
            });
          } catch (err) {
            console.warn('Failed to register folder on server:', err);
          }
        }

        return { id, name: name.trim() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [getDatabase, vfsKeys, auth, featureFlags, vfsApi]
  );

  return {
    createFolder,
    isCreating,
    error
  };
}
