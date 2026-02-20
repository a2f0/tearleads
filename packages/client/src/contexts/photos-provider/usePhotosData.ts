/**
 * Hook for photos data fetching operations.
 */

import type { PhotoInfo, PhotoWithUrl } from '@tearleads/photos';
import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { useCallback } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { logStore } from '@/stores/logStore';

const ALL_PHOTOS_ID = '__all__';

interface UsePhotosDataResult {
  loadPhotoWithUrl: (photo: PhotoInfo) => Promise<PhotoWithUrl | null>;
  fetchPhotos: (options: {
    albumId?: string | null;
    includeDeleted?: boolean;
  }) => Promise<PhotoWithUrl[]>;
  fetchPhotoById: (photoId: string) => Promise<PhotoWithUrl | null>;
  softDeletePhoto: (photoId: string) => Promise<void>;
  restorePhoto: (photoId: string) => Promise<void>;
  downloadPhotoData: (photo: PhotoWithUrl) => Promise<Uint8Array>;
  sharePhotoData: (photo: PhotoWithUrl) => Promise<Uint8Array>;
}

export function usePhotosData(): UsePhotosDataResult {
  const { currentInstanceId } = useDatabaseContext();

  const loadPhotoWithUrl = useCallback(
    async (photo: PhotoInfo): Promise<PhotoWithUrl | null> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      try {
        const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
        const mimeType = photo.thumbnailPath ? 'image/jpeg' : photo.mimeType;
        const data = await storage.retrieve(pathToLoad);
        assertPlainArrayBuffer(data);
        const blob = new Blob([data], { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        return { ...photo, objectUrl };
      } catch (err) {
        logStore.error(`Failed to load photo ${photo.name}`, String(err));
        return null;
      }
    },
    [currentInstanceId]
  );

  const fetchPhotos = useCallback(
    async (options: {
      albumId?: string | null;
      includeDeleted?: boolean;
    }): Promise<PhotoWithUrl[]> => {
      const { albumId, includeDeleted = false } = options;
      const db = getDatabase();

      // If a specific album is selected, get the photo IDs in that album
      let photoIdsInAlbum: string[] | null = null;
      if (albumId && albumId !== ALL_PHOTOS_ID) {
        const { vfsLinks } = await import('@/db/schema');
        const albumLinks = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, albumId));
        photoIdsInAlbum = albumLinks.map((l) => l.childId);

        // If album is empty, return early
        if (photoIdsInAlbum.length === 0) {
          return [];
        }
      }

      // Build the where clause
      const baseConditions = and(
        like(files.mimeType, 'image/%'),
        includeDeleted ? undefined : eq(files.deleted, false)
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

      const photosWithUrls = (
        await Promise.all(photoList.map(loadPhotoWithUrl))
      ).filter((photo): photo is PhotoWithUrl => photo !== null);

      return photosWithUrls;
    },
    [loadPhotoWithUrl]
  );

  const fetchPhotoById = useCallback(
    async (photoId: string): Promise<PhotoWithUrl | null> => {
      const db = getDatabase();

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
        .where(and(eq(files.id, photoId), like(files.mimeType, 'image/%')))
        .limit(1);

      const row = result[0];
      if (!row) {
        return null;
      }

      const photo: PhotoInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      };

      return loadPhotoWithUrl(photo);
    },
    [loadPhotoWithUrl]
  );

  const softDeletePhoto = useCallback(
    async (photoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, photoId));
    },
    []
  );

  const restorePhoto = useCallback(async (photoId: string): Promise<void> => {
    const db = getDatabase();
    await db.update(files).set({ deleted: false }).where(eq(files.id, photoId));
  }, []);

  const downloadPhotoData = useCallback(
    async (photo: PhotoWithUrl): Promise<Uint8Array> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(photo.storagePath);
      assertPlainArrayBuffer(data);
      return new Uint8Array(data);
    },
    [currentInstanceId]
  );

  const sharePhotoData = useCallback(
    async (photo: PhotoWithUrl): Promise<Uint8Array> => {
      // Same implementation as downloadPhotoData - get the full file
      return downloadPhotoData(photo);
    },
    [downloadPhotoData]
  );

  return {
    loadPhotoWithUrl,
    fetchPhotos,
    fetchPhotoById,
    softDeletePhoto,
    restorePhoto,
    downloadPhotoData,
    sharePhotoData
  };
}
