import type { CameraPhotoRollItem } from '@tearleads/app-camera';
import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePhotoAlbums } from '@/components/window-photos/usePhotoAlbums';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, vfsLinks } from '@/db/schema';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

interface UseCameraPhotoRollResult {
  photos: CameraPhotoRollItem[];
  loading: boolean;
}

export function useCameraPhotoRoll(): UseCameraPhotoRollResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const { getPhotoRollAlbum, hasFetched: albumsFetched } = usePhotoAlbums();
  const [photos, setPhotos] = useState<CameraPhotoRollItem[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetchPhotos = useCallback(async () => {
    if (!isUnlocked || !currentInstanceId) return;

    const photoRoll = getPhotoRollAlbum();
    if (!photoRoll) return;

    setLoading(true);

    try {
      const db = getDatabase();

      const albumLinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, photoRoll.id));

      if (albumLinks.length === 0) {
        setPhotos([]);
        return;
      }

      const photoIds = albumLinks.map((l) => l.childId);

      const photoRows = await db
        .select({
          id: files.id,
          mimeType: files.mimeType,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(and(eq(files.deleted, false), inArray(files.id, photoIds)))
        .orderBy(desc(files.uploadDate));

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) return;

      if (!isFileStorageInitialized(currentInstanceId)) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const items = (
        await Promise.all(
          photoRows.map(async (photo) => {
            try {
              const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
              const mimeType = photo.thumbnailPath
                ? 'image/jpeg'
                : photo.mimeType;
              const data = await storage.retrieve(pathToLoad);
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: mimeType });
              const thumbnailUrl = URL.createObjectURL(blob);
              return { id: photo.id, thumbnailUrl };
            } catch {
              return null;
            }
          })
        )
      ).filter((item): item is CameraPhotoRollItem => item !== null);

      setPhotos(items);
      fetchedRef.current = true;
    } catch (err) {
      console.error('Failed to load camera photo roll:', err);
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, getPhotoRollAlbum]);

  useEffect(() => {
    if (!isUnlocked || !albumsFetched || fetchedRef.current) return;
    void fetchPhotos();
  }, [isUnlocked, albumsFetched, fetchPhotos]);

  useEffect(() => {
    return () => {
      for (const photo of photos) {
        URL.revokeObjectURL(photo.thumbnailUrl);
      }
    };
  }, [photos]);

  return { photos, loading };
}
