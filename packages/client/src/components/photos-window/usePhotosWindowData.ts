import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, vfsLinks } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { ALL_PHOTOS_ID } from './PhotosAlbumsSidebar';

interface PhotoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
  deleted: boolean;
}

export interface PhotoWithUrl extends PhotoInfo {
  objectUrl: string;
}

interface UsePhotosWindowDataProps {
  refreshToken: number;
  selectedAlbumId?: string | null | undefined;
  showDeleted?: boolean | undefined;
}

export function usePhotosWindowData({
  refreshToken,
  selectedAlbumId,
  showDeleted = false
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

      // If a specific album is selected, get the photo IDs in that album
      let photoIdsInAlbum: string[] | null = null;
      if (selectedAlbumId && selectedAlbumId !== ALL_PHOTOS_ID) {
        const albumLinks = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, selectedAlbumId));
        photoIdsInAlbum = albumLinks.map((l) => l.childId);

        // If album is empty, return early
        if (photoIdsInAlbum.length === 0) {
          setPhotos([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      // Build the where clause
      const baseConditions = and(
        like(files.mimeType, 'image/%'),
        showDeleted ? undefined : eq(files.deleted, false)
      );
      const whereClause = photoIdsInAlbum
        ? and(baseConditions, inArray(files.id, photoIdsInAlbum))
        : baseConditions;

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath,
          deleted: files.deleted
        })
        .from(files)
        .where(whereClause)
        .orderBy(desc(files.uploadDate));

      const photoList: PhotoInfo[] = result.map((row) => ({
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
  }, [currentInstanceId, isUnlocked, selectedAlbumId, showDeleted]);

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

  const deletePhoto = useCallback(
    async (photoId: string) => {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, photoId));
      await fetchPhotos();
    },
    [fetchPhotos]
  );

  const restorePhoto = useCallback(
    async (photoId: string) => {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: false })
        .where(eq(files.id, photoId));
      await fetchPhotos();
    },
    [fetchPhotos]
  );

  const downloadPhoto = useCallback(
    async (photo: PhotoWithUrl) => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      return storage.retrieve(photo.storagePath);
    },
    [currentInstanceId]
  );

  const sharePhoto = useCallback(
    async (photo: PhotoWithUrl) => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      return storage.retrieve(photo.storagePath);
    },
    [currentInstanceId]
  );

  return {
    photos,
    loading,
    error,
    hasFetched,
    isUnlocked,
    isLoading,
    refresh: fetchPhotos,
    currentInstanceId,
    deletePhoto,
    restorePhoto,
    downloadPhoto,
    sharePhoto
  };
}
