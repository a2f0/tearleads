/**
 * Hook for file download and share actions in Photos component.
 */

import { useCallback, useEffect, useState } from 'react';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import type { PhotoWithUrl } from './types';

interface UsePhotosFileActionsOptions {
  setError: (error: string | null) => void;
}

export function usePhotosFileActions({
  setError
}: UsePhotosFileActionsOptions) {
  const { currentInstanceId } = useDatabaseContext();
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');
        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }
        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        downloadFile(data, photo.name);
      } catch (err) {
        console.error('Failed to download photo:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId, setError]
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');
        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }
        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share photo:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId, setError]
  );

  return {
    canShare,
    handleDownload,
    handleShare
  };
}
