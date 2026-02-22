/**
 * Hook for copying VFS items to a folder (creates an additional link).
 */

import { vfsLinks } from '@tearleads/db/sqlite';
import { and, eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../context';

interface UseCopyVfsItemResult {
  copyItem: (itemId: string, targetFolderId: string) => Promise<void>;
  isCopying: boolean;
  error: string | null;
}

export function useCopyVfsItem(): UseCopyVfsItemResult {
  const { getDatabase, vfsKeys, auth } = useVfsExplorerContext();
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyItem = useCallback(
    async (itemId: string, targetFolderId: string): Promise<void> => {
      if (!itemId || !targetFolderId) {
        throw new Error('Item ID and target folder ID are required');
      }

      setIsCopying(true);
      setError(null);

      try {
        const db = getDatabase();
        const now = new Date();

        // Check if link already exists
        const existingLink = await db.query.vfsLinks.findFirst({
          where: and(
            eq(vfsLinks.parentId, targetFolderId),
            eq(vfsLinks.childId, itemId)
          )
        });

        // Check for actual link existence by verifying id is defined
        // (Drizzle may return an object with undefined properties instead of null)
        if (existingLink?.id) {
          // Item already exists in this folder
          return;
        }

        let wrappedSessionKey: string | null = null;
        if (auth.isLoggedIn()) {
          try {
            const sessionKey = vfsKeys.generateSessionKey();
            wrappedSessionKey = await vfsKeys.wrapSessionKey(sessionKey);
          } catch (err) {
            console.warn('Failed to wrap session key for copy:', err);
          }
        }

        // Create new link to target folder (without removing existing links)
        const linkId = crypto.randomUUID();
        await db.insert(vfsLinks).values({
          id: linkId,
          parentId: targetFolderId,
          childId: itemId,
          wrappedSessionKey: wrappedSessionKey ?? '',
          createdAt: now
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsCopying(false);
      }
    },
    [getDatabase, vfsKeys, auth]
  );

  return {
    copyItem,
    isCopying,
    error
  };
}
