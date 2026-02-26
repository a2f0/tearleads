import { and, eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { albums, files, vfsLinks, vfsRegistry } from '@/db/schema';
import {
  type AlbumType,
  type PhotoAlbum,
  SYSTEM_ALBUM_NAMES,
  SYSTEM_ALBUM_TYPES
} from './albumTypes';

/**
 * Module-level guard that deduplicates initializeSystemAlbums calls across
 * all concurrent hook instances (e.g. PhotosWindow, PhotosAlbumsSidebar,
 * NewAlbumDialog all mount simultaneously). Keyed by database instance ID
 * so a database reset re-runs initialization.
 */
const systemAlbumInitPromises = new Map<string, Promise<void>>();

/**
 * Reset the module-level guard. Exposed for tests only.
 */
export function resetSystemAlbumInitGuard(): void {
  systemAlbumInitPromises.clear();
}

export type { PhotoAlbum };

interface UsePhotoAlbumsResult {
  albums: PhotoAlbum[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
  createAlbum: (name: string) => Promise<string>;
  renameAlbum: (albumId: string, newName: string) => Promise<void>;
  deleteAlbum: (albumId: string) => Promise<void>;
  addPhotoToAlbum: (albumId: string, photoId: string) => Promise<void>;
  removePhotoFromAlbum: (albumId: string, photoId: string) => Promise<void>;
  getPhotoIdsInAlbum: (albumId: string) => Promise<string[]>;
  getPhotoRollAlbum: () => PhotoAlbum | undefined;
}

function isDatabaseNotInitializedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes('Database not initialized')) return true;

  const cause = 'cause' in error ? error.cause : undefined;
  return (
    cause instanceof Error && cause.message.includes('Database not initialized')
  );
}

export function usePhotoAlbums(): UsePhotoAlbumsResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [albumList, setAlbumList] = useState<PhotoAlbum[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchAlbums = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all albums with their names and types
      const albumRows = await db
        .select({
          id: vfsRegistry.id,
          name: albums.encryptedName,
          coverPhotoId: albums.coverPhotoId,
          albumType: albums.albumType
        })
        .from(vfsRegistry)
        .innerJoin(albums, eq(albums.id, vfsRegistry.id))
        .where(eq(vfsRegistry.objectType, 'album'));

      if (albumRows.length === 0) {
        setAlbumList([]);
        setHasFetched(true);
        return;
      }

      const albumIds = albumRows.map((a) => a.id);

      // Get photo counts for each album (excluding deleted files)
      const childCountRows = await db
        .select({
          parentId: vfsLinks.parentId
        })
        .from(vfsLinks)
        .innerJoin(files, eq(files.id, vfsLinks.childId))
        .where(
          and(inArray(vfsLinks.parentId, albumIds), eq(files.deleted, false))
        );

      const photoCountMap = new Map<string, number>();
      for (const row of childCountRows) {
        photoCountMap.set(
          row.parentId,
          (photoCountMap.get(row.parentId) || 0) + 1
        );
      }

      const result: PhotoAlbum[] = albumRows.map((album) => ({
        id: album.id,
        name: album.name || 'Unnamed Album',
        photoCount: photoCountMap.get(album.id) || 0,
        coverPhotoId: album.coverPhotoId,
        albumType: (album.albumType || 'custom') as AlbumType
      }));

      // Sort: system albums first, then alphabetically
      result.sort((a, b) => {
        const systemTypes = SYSTEM_ALBUM_TYPES as readonly string[];
        const aIsSystem = systemTypes.includes(a.albumType);
        const bIsSystem = systemTypes.includes(b.albumType);
        if (aIsSystem && !bIsSystem) return -1;
        if (!aIsSystem && bIsSystem) return 1;
        return a.name.localeCompare(b.name);
      });

      setAlbumList(result);
      setHasFetched(true);
    } catch (err) {
      if (isDatabaseNotInitializedError(err)) {
        // Database setup can race briefly during app/test initialization.
        // Skip surfacing/logging this transient state and let the next fetch retry.
        return;
      }
      console.error('Failed to fetch photo albums:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  const initializeSystemAlbums = useCallback(async () => {
    if (!isUnlocked) return;

    try {
      const db = getDatabase();

      for (const albumType of SYSTEM_ALBUM_TYPES) {
        // Use a transaction so the check-then-insert is atomic.
        // Without this, concurrent callers can all read "0 existing"
        // and each insert a duplicate system album.
        await db.transaction(async (tx) => {
          const existing = await tx
            .select({ id: albums.id })
            .from(albums)
            .where(eq(albums.albumType, albumType));

          if (existing.length === 0) {
            const albumId = crypto.randomUUID();
            const now = new Date();
            const albumName = SYSTEM_ALBUM_NAMES[albumType];

            await tx.insert(vfsRegistry).values({
              id: albumId,
              objectType: 'album',
              ownerId: null,
              createdAt: now
            });

            await tx.insert(albums).values({
              id: albumId,
              encryptedName: albumName,
              encryptedDescription: null,
              coverPhotoId: null,
              albumType
            });
          }
        });
      }
    } catch (err) {
      if (!isDatabaseNotInitializedError(err)) {
        console.warn('Failed to initialize system albums:', err);
      }
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;

    // Module-level guard: only the first hook instance for a given database
    // instance triggers initialization. All other concurrent instances
    // (e.g. from sibling components) share the same promise.
    if (!systemAlbumInitPromises.has(currentInstanceId)) {
      const promise = initializeSystemAlbums()
        .then(() => fetchAlbums())
        .catch(() => fetchAlbums());
      systemAlbumInitPromises.set(currentInstanceId, promise);
    } else {
      // Another instance already started init; wait for it then fetch
      systemAlbumInitPromises
        .get(currentInstanceId)
        ?.then(() => fetchAlbums())
        .catch(() => fetchAlbums());
    }
  }, [isUnlocked, currentInstanceId, initializeSystemAlbums, fetchAlbums]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setAlbumList([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchAlbums();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchAlbums]);

  const createAlbum = useCallback(
    async (name: string): Promise<string> => {
      const db = getDatabase();
      const albumId = crypto.randomUUID();
      const now = new Date();

      // Create registry entry
      await db.insert(vfsRegistry).values({
        id: albumId,
        objectType: 'album',
        ownerId: null, // Device-first, no owner yet
        createdAt: now
      });

      // Create album metadata
      await db.insert(albums).values({
        id: albumId,
        encryptedName: name,
        encryptedDescription: null,
        coverPhotoId: null
      });

      await fetchAlbums();
      return albumId;
    },
    [fetchAlbums]
  );

  const renameAlbum = useCallback(
    async (albumId: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(albums)
        .set({ encryptedName: newName })
        .where(eq(albums.id, albumId));
      await fetchAlbums();
    },
    [fetchAlbums]
  );

  const deleteAlbum = useCallback(
    async (albumId: string): Promise<void> => {
      const db = getDatabase();

      // Delete links first (photos stay, just unlinked from album)
      await db.delete(vfsLinks).where(eq(vfsLinks.parentId, albumId));

      // Delete album metadata
      await db.delete(albums).where(eq(albums.id, albumId));

      // Delete registry entry
      await db.delete(vfsRegistry).where(eq(vfsRegistry.id, albumId));

      await fetchAlbums();
    },
    [fetchAlbums]
  );

  const addPhotoToAlbum = useCallback(
    async (albumId: string, photoId: string): Promise<void> => {
      const db = getDatabase();
      const linkId = crypto.randomUUID();
      const now = new Date();

      // Check if link already exists
      const existing = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, albumId), eq(vfsLinks.childId, photoId))
        );

      if (existing.length > 0) {
        return; // Already linked
      }

      // TODO(pilot): wrappedSessionKey is empty for the pilot implementation.
      // When full E2EE is implemented, this should contain the album's session
      // key wrapped with the photo's key (or vice versa) to maintain the
      // encryption chain. For now, photos are already encrypted individually
      // and albums just organize references - no re-encryption needed yet.
      await db.insert(vfsLinks).values({
        id: linkId,
        parentId: albumId,
        childId: photoId,
        wrappedSessionKey: '',
        createdAt: now
      });

      await fetchAlbums();
    },
    [fetchAlbums]
  );

  const removePhotoFromAlbum = useCallback(
    async (albumId: string, photoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .delete(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, albumId), eq(vfsLinks.childId, photoId))
        );
      await fetchAlbums();
    },
    [fetchAlbums]
  );

  const getPhotoIdsInAlbum = useCallback(
    async (albumId: string): Promise<string[]> => {
      const db = getDatabase();
      const links = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, albumId));
      return links.map((l) => l.childId);
    },
    []
  );

  const getPhotoRollAlbum = useCallback((): PhotoAlbum | undefined => {
    return albumList.find((album) => album.albumType === 'photoroll');
  }, [albumList]);

  return {
    albums: albumList,
    loading,
    error,
    hasFetched,
    refetch: fetchAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addPhotoToAlbum,
    removePhotoFromAlbum,
    getPhotoIdsInAlbum,
    getPhotoRollAlbum
  };
}
