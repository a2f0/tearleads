/**
 * Hook for moving VFS items between folders.
 */

import { vfsLinks } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface UseMoveVfsItemResult {
  moveItem: (itemId: string, targetFolderId: string) => Promise<void>;
  isMoving: boolean;
  error: string | null;
}

export function useMoveVfsItem(): UseMoveVfsItemResult {
  const { getDatabase, vfsKeys, auth } = useVfsExplorerContext();
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moveItem = useCallback(
    async (itemId: string, targetFolderId: string): Promise<void> => {
      if (!itemId || !targetFolderId) {
        throw new Error('Item ID and target folder ID are required');
      }

      setIsMoving(true);
      setError(null);

      try {
        const db = getDatabase();
        const now = new Date();

        let wrappedSessionKey: string | null = null;
        if (auth.isLoggedIn()) {
          try {
            const sessionKey = vfsKeys.generateSessionKey();
            wrappedSessionKey = await vfsKeys.wrapSessionKey(sessionKey);
          } catch (err) {
            console.warn('Failed to wrap session key for move:', err);
          }
        }

        await db.transaction(async (tx) => {
          // Remove existing link for this item (if any)
          await tx.delete(vfsLinks).where(eq(vfsLinks.childId, itemId));

          // Create new link to target folder
          const linkId = crypto.randomUUID();
          await tx.insert(vfsLinks).values({
            id: linkId,
            parentId: targetFolderId,
            childId: itemId,
            wrappedSessionKey: wrappedSessionKey ?? '',
            createdAt: now
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsMoving(false);
      }
    },
    [getDatabase, vfsKeys, auth]
  );

  return {
    moveItem,
    isMoving,
    error
  };
}
