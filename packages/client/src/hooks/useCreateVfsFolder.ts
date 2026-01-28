/**
 * Hook for creating VFS folders.
 */

import { useCallback, useState } from 'react';
import { getDatabase } from '@/db';
import { vfsFolders, vfsLinks, vfsRegistry } from '@/db/schema';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';
import { generateSessionKey, wrapSessionKey } from './useVfsKeys';

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
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encodeSessionKey = useCallback((key: Uint8Array): string => {
    let binary = '';
    for (const byte of key) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }, []);

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
        const auth = readStoredAuth();
        const ownerId = auth.user?.id || 'unknown';

        const sessionKey = generateSessionKey();
        let encryptedSessionKey = encodeSessionKey(sessionKey);
        if (isLoggedIn()) {
          try {
            encryptedSessionKey = await wrapSessionKey(sessionKey);
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
            ownerId,
            encryptedSessionKey,
            createdAt: now
          });

          // Insert into local vfs_folders
          await tx.insert(vfsFolders).values({
            id,
            encryptedName: name.trim()
          });

          // If parent folder specified, create link
          if (parentId) {
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

        return { id, name: name.trim() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [encodeSessionKey]
  );

  return {
    createFolder,
    isCreating,
    error
  };
}
