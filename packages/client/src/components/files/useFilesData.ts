/**
 * Hook for loading and managing files data.
 */

import { desc } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files as filesTable } from '@/db/schema';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage
} from '@/storage/opfs';
import type { FileInfo, FileWithThumbnail } from './types';

interface UseFilesDataOptions {
  refreshToken?: number | undefined;
}

interface UseFilesDataReturn {
  files: FileWithThumbnail[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchFiles: () => Promise<void>;
  setFiles: React.Dispatch<React.SetStateAction<FileWithThumbnail[]>>;
  setError: (error: string | null) => void;
}

export function useFilesData({
  refreshToken
}: UseFilesDataOptions = {}): UseFilesDataReturn {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [files, setFiles] = useState<FileWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  // Clear files immediately when instance changes via direct subscription
  useOnInstanceChange(
    useCallback(() => {
      // Revoke all thumbnail URLs to prevent memory leaks
      setFiles((prevFiles) => {
        for (const file of prevFiles) {
          if (file.thumbnailUrl) {
            URL.revokeObjectURL(file.thumbnailUrl);
          }
        }
        return [];
      });
      setError(null);
      setHasFetched(false);
    }, [])
  );

  const fetchFiles = useCallback(async () => {
    if (!isUnlocked) return;

    // Capture instance ID at fetch start to detect stale responses
    const fetchInstanceId = currentInstanceId;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: filesTable.id,
          name: filesTable.name,
          size: filesTable.size,
          mimeType: filesTable.mimeType,
          uploadDate: filesTable.uploadDate,
          storagePath: filesTable.storagePath,
          thumbnailPath: filesTable.thumbnailPath,
          deleted: filesTable.deleted
        })
        .from(filesTable)
        .orderBy(desc(filesTable.uploadDate));

      const fileList: FileInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      await initializeFileStorage(encryptionKey, currentInstanceId);

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      const filesWithThumbnails: FileWithThumbnail[] = await Promise.all(
        fileList.map(async (file) => {
          if (!file.thumbnailPath) {
            return { ...file, thumbnailUrl: null };
          }
          try {
            const data = await storage.measureRetrieve(
              file.thumbnailPath,
              logger
            );
            const blob = new Blob([new Uint8Array(data)], {
              type: 'image/jpeg'
            });
            const thumbnailUrl = URL.createObjectURL(blob);
            return { ...file, thumbnailUrl };
          } catch (err) {
            console.warn(`Failed to load thumbnail for ${file.name}:`, err);
            return { ...file, thumbnailUrl: null };
          }
        })
      );

      // Guard: if instance changed during fetch, discard stale results
      if (fetchInstanceId !== currentInstanceId) {
        // Revoke URLs we just created since they won't be used
        for (const file of filesWithThumbnails) {
          if (file.thumbnailUrl) {
            URL.revokeObjectURL(file.thumbnailUrl);
          }
        }
        return;
      }

      setFiles(filesWithThumbnails);
      setHasFetched(true);
    } catch (err) {
      // Guard: don't set error state if instance changed
      if (fetchInstanceId !== currentInstanceId) return;
      console.error('Failed to fetch files:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Guard: don't clear loading if instance changed (new fetch may be starting)
      if (fetchInstanceId === currentInstanceId) {
        setLoading(false);
      }
    }
  }, [isUnlocked, currentInstanceId]);

  // Fetch files when unlocked and instance is ready
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasFetched intentionally excluded
  useEffect(() => {
    const needsFetch = isUnlocked && !loading && !hasFetched;

    if (needsFetch) {
      const timeoutId = setTimeout(() => {
        fetchFiles();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, fetchFiles]);

  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0 && isUnlocked) {
      fetchFiles();
    }
  }, [refreshToken, isUnlocked, fetchFiles]);

  useEffect(() => {
    return () => {
      for (const file of files) {
        if (file.thumbnailUrl) {
          URL.revokeObjectURL(file.thumbnailUrl);
        }
      }
    };
  }, [files]);

  return {
    files,
    loading,
    error,
    hasFetched,
    fetchFiles,
    setFiles,
    setError
  };
}
