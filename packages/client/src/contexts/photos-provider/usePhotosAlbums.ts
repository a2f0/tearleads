/**
 * Hook for photos album operations.
 */

import type { PhotoAlbum } from '@tearleads/photos';
import { and, eq, inArray } from 'drizzle-orm';
import { useCallback } from 'react';
import { getDatabase } from '@/db';
import { albums, files, vfsLinks, vfsRegistry } from '@/db/schema';

interface UsePhotosAlbumsResult {
  fetchAlbums: () => Promise<PhotoAlbum[]>;
  createAlbum: (name: string) => Promise<string>;
  renameAlbum: (albumId: string, newName: string) => Promise<void>;
  deleteAlbum: (albumId: string) => Promise<void>;
  addPhotoToAlbum: (albumId: string, photoId: string) => Promise<void>;
  removePhotoFromAlbum: (albumId: string, photoId: string) => Promise<void>;
  getPhotoIdsInAlbum: (albumId: string) => Promise<string[]>;
}

export function usePhotosAlbums(): UsePhotosAlbumsResult {
  const fetchAlbums = useCallback(async (): Promise<PhotoAlbum[]> => {
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
      return [];
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
      albumType: (album.albumType || 'custom') as 'photoroll' | 'custom'
    }));

    // Sort: system albums first, then alphabetically
    result.sort((a, b) => {
      const aIsSystem = a.albumType === 'photoroll';
      const bIsSystem = b.albumType === 'photoroll';
      if (aIsSystem && !bIsSystem) return -1;
      if (!aIsSystem && bIsSystem) return 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, []);

  const createAlbum = useCallback(async (name: string): Promise<string> => {
    const db = getDatabase();
    const albumId = crypto.randomUUID();
    const now = new Date();

    await db.insert(vfsRegistry).values({
      id: albumId,
      objectType: 'album',
      ownerId: null,
      createdAt: now
    });

    await db.insert(albums).values({
      id: albumId,
      encryptedName: name,
      encryptedDescription: null,
      coverPhotoId: null
    });

    return albumId;
  }, []);

  const renameAlbum = useCallback(
    async (albumId: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(albums)
        .set({ encryptedName: newName })
        .where(eq(albums.id, albumId));
    },
    []
  );

  const deleteAlbum = useCallback(async (albumId: string): Promise<void> => {
    const db = getDatabase();

    // Delete links first (photos stay, just unlinked from album)
    await db.delete(vfsLinks).where(eq(vfsLinks.parentId, albumId));

    // Delete album metadata
    await db.delete(albums).where(eq(albums.id, albumId));

    // Delete registry entry
    await db.delete(vfsRegistry).where(eq(vfsRegistry.id, albumId));
  }, []);

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

      await db.insert(vfsLinks).values({
        id: linkId,
        parentId: albumId,
        childId: photoId,
        wrappedSessionKey: '',
        createdAt: now
      });
    },
    []
  );

  const removePhotoFromAlbum = useCallback(
    async (albumId: string, photoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .delete(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, albumId), eq(vfsLinks.childId, photoId))
        );
    },
    []
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

  return {
    fetchAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addPhotoToAlbum,
    removePhotoFromAlbum,
    getPhotoIdsInAlbum
  };
}
