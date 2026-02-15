/**
 * Hook for creating VFS folders.
 */

import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { useCallback, useState } from 'react';
import { VFS_ROOT_ID } from '../constants';
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
      const trimmedName = name.trim();
      if (!trimmedName) {
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

        // Determine the parent folder ID
        const effectiveParentId = parentId ?? VFS_ROOT_ID;

        // Use transaction to ensure atomicity
        await db.transaction(async (tx) => {
          // If linking to VFS root, ensure it exists first using onConflictDoNothing
          // to handle concurrent folder creation requests gracefully
          if (effectiveParentId === VFS_ROOT_ID) {
            await tx
              .insert(vfsRegistry)
              .values({
                id: VFS_ROOT_ID,
                objectType: 'folder',
                ownerId: null,
                encryptedSessionKey: null,
                // Guardrail: canonical folder metadata lives on vfs_registry.
                encryptedName: 'VFS Root',
                createdAt: now
              })
              .onConflictDoNothing();
          }

          // Insert into local vfs_registry
          await tx.insert(vfsRegistry).values({
            id,
            objectType: 'folder',
            ownerId: authData.user?.id ?? null,
            encryptedSessionKey,
            // Guardrail: folder metadata is canonical on vfs_registry.
            encryptedName: trimmedName,
            createdAt: now
          });

          // Create link to parent folder (or VFS root if no parent specified)
          const linkId = crypto.randomUUID();
          await tx.insert(vfsLinks).values({
            id: linkId,
            parentId: effectiveParentId,
            childId: id,
            wrappedSessionKey: encryptedSessionKey ?? '',
            createdAt: now
          });
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

        return { id, name: trimmedName };
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
