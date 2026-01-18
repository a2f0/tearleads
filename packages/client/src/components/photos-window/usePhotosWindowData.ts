import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, desc, eq, like } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

export interface PhotoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export interface PhotoWithUrl extends PhotoInfo {
  objectUrl: string;
}

interface UsePhotosWindowDataProps {
  refreshToken: number;
}

export function usePhotosWindowData({
  refreshToken
}: UsePhotosWindowDataProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(and(like(files.mimeType, 'image/%'), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate));

      const photoList: PhotoInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const photosWithUrls = (
        await Promise.all(
          photoList.map(async (photo) => {
            try {
              const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
              const mimeType = photo.thumbnailPath
                ? 'image/jpeg'
                : photo.mimeType;
              const data = await storage.retrieve(pathToLoad);
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: mimeType });
              const objectUrl = URL.createObjectURL(blob);
              return { ...photo, objectUrl };
            } catch (err) {
              console.error(`Failed to load photo ${photo.name}:`, err);
              return null;
            }
          })
        )
      ).filter((photo): photo is PhotoWithUrl => photo !== null);

      setPhotos(photosWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch photos:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentInstanceId, isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;
    void refreshToken;
    fetchPhotos();
  }, [fetchPhotos, isUnlocked, refreshToken]);

  useEffect(() => {
    return () => {
      for (const photo of photos) {
        URL.revokeObjectURL(photo.objectUrl);
      }
    };
  }, [photos]);

  return {
    photos,
    loading,
    error,
    hasFetched,
    isUnlocked,
    isLoading,
    refresh: fetchPhotos,
    currentInstanceId
  };
}
