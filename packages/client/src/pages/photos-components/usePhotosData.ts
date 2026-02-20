/**
 * Hook for loading and managing photos data.
 */

import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_PHOTOS_ID } from '@/components/photos-window/PhotosAlbumsSidebar';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, vfsLinks } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import type { PhotoInfo, PhotoWithUrl } from './types';

interface UsePhotosDataOptions {
  showDeleted: boolean;
  selectedAlbumId?: string | null | undefined;
  refreshToken?: number | undefined;
}

interface UsePhotosDataReturn {
  photos: PhotoWithUrl[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchPhotos: () => Promise<void>;
  setHasFetched: (value: boolean) => void;
  setError: (error: string | null) => void;
}

export function usePhotosData({
  showDeleted,
  selectedAlbumId,
  refreshToken
}: UsePhotosDataOptions): UsePhotosDataReturn {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

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

      // Load image data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const photosWithUrls = (
        await Promise.all(
          photoList.map(async (photo) => {
            try {
              // Prefer thumbnail for gallery view, fall back to full image
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
      ).filter((p): p is PhotoWithUrl => p !== null);

      setPhotos(photosWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch photos:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, selectedAlbumId, showDeleted]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: photos intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      // If instance changed, cleanup old object URLs first
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const photo of photos) {
          URL.revokeObjectURL(photo.objectUrl);
        }
        setPhotos([]);
        setError(null);
      }

      // Update ref before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchPhotos();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchPhotos]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const p of photos) {
        URL.revokeObjectURL(p.objectUrl);
      }
    };
  }, [photos]);

  useEffect(() => {
    if (refreshToken === undefined) return;
    setHasFetched(false);
  }, [refreshToken]);

  return {
    photos,
    loading,
    error,
    hasFetched,
    fetchPhotos,
    setHasFetched,
    setError
  };
}
