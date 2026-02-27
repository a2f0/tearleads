/**
 * Client-side VideoPlaylistProvider wrapper that supplies all dependencies
 * for video playlist functionality.
 */

import { and, eq, sql } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { logStore } from '@/stores/logStore';
import type { VideoPlaylist } from '@/video/VideoPlaylistContext';
import { VideoPlaylistProvider } from '@/video/VideoPlaylistContext';

interface ClientVideoProviderProps {
  children: ReactNode;
}

export function ClientVideoProvider({ children }: ClientVideoProviderProps) {
  const databaseContext = useDatabaseContext();

  const databaseState = useMemo(
    () => ({
      isUnlocked: databaseContext.isUnlocked,
      isLoading: databaseContext.isLoading,
      currentInstanceId: databaseContext.currentInstanceId
    }),
    [
      databaseContext.isUnlocked,
      databaseContext.isLoading,
      databaseContext.currentInstanceId
    ]
  );

  const fetchPlaylists = useCallback(async (): Promise<VideoPlaylist[]> => {
    const db = getDatabase();

    const trackCountsSubQuery = db
      .select({
        parentId: vfsLinks.parentId,
        trackCount: sql<number>`count(*)`.as('track_count')
      })
      .from(vfsLinks)
      .innerJoin(files, eq(files.id, vfsLinks.childId))
      .where(eq(files.deleted, false))
      .groupBy(vfsLinks.parentId)
      .as('trackCounts');

    const playlistRows = await db
      .select({
        id: vfsRegistry.id,
        name: playlists.encryptedName,
        coverImageId: playlists.coverImageId,
        mediaType: playlists.mediaType,
        trackCount: sql<number>`
          coalesce(${trackCountsSubQuery.trackCount}, 0)
        `.mapWith(Number)
      })
      .from(vfsRegistry)
      .innerJoin(playlists, eq(playlists.id, vfsRegistry.id))
      .leftJoin(
        trackCountsSubQuery,
        eq(vfsRegistry.id, trackCountsSubQuery.parentId)
      )
      .where(
        and(
          eq(vfsRegistry.objectType, 'playlist'),
          eq(playlists.mediaType, 'video')
        )
      );

    if (playlistRows.length === 0) return [];

    const result: VideoPlaylist[] = playlistRows.map((playlist) => ({
      id: playlist.id,
      name: playlist.name || 'Unnamed Playlist',
      trackCount: Number(playlist.trackCount) || 0,
      coverImageId: playlist.coverImageId,
      mediaType: playlist.mediaType
    }));

    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }, []);

  const createPlaylist = useCallback(async (name: string): Promise<string> => {
    const db = getDatabase();
    const playlistId = crypto.randomUUID();
    const now = new Date();

    await db.insert(vfsRegistry).values({
      id: playlistId,
      objectType: 'playlist',
      ownerId: null,
      encryptedName: name,
      createdAt: now
    });

    await db.insert(playlists).values({
      id: playlistId,
      encryptedName: name,
      encryptedDescription: null,
      coverImageId: null,
      shuffleMode: 0,
      mediaType: 'video'
    });

    return playlistId;
  }, []);

  const renamePlaylist = useCallback(
    async (playlistId: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(playlists)
        .set({ encryptedName: newName })
        .where(eq(playlists.id, playlistId));
      await db
        .update(vfsRegistry)
        .set({ encryptedName: newName })
        .where(eq(vfsRegistry.id, playlistId));
    },
    []
  );

  const deletePlaylist = useCallback(
    async (playlistId: string): Promise<void> => {
      const db = getDatabase();

      await db.delete(vfsLinks).where(eq(vfsLinks.parentId, playlistId));
      await db.delete(playlists).where(eq(playlists.id, playlistId));
      await db.delete(vfsRegistry).where(eq(vfsRegistry.id, playlistId));
    },
    []
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId: string, videoId: string): Promise<void> => {
      const db = getDatabase();
      const linkId = crypto.randomUUID();
      const now = new Date();

      const existing = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, playlistId), eq(vfsLinks.childId, videoId))
        );

      if (existing.length > 0) return;

      await db.insert(vfsLinks).values({
        id: linkId,
        parentId: playlistId,
        childId: videoId,
        wrappedSessionKey: '',
        createdAt: now
      });
    },
    []
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, videoId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .delete(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, playlistId), eq(vfsLinks.childId, videoId))
        );
    },
    []
  );

  const getTrackIdsInPlaylist = useCallback(
    async (playlistId: string): Promise<string[]> => {
      const db = getDatabase();
      const links = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, playlistId));
      return links.map((link) => link.childId);
    },
    []
  );

  const logError = useCallback(
    (message: string, details?: string) => logStore.error(message, details),
    []
  );

  return (
    <VideoPlaylistProvider
      databaseState={databaseState}
      fetchPlaylists={fetchPlaylists}
      createPlaylist={createPlaylist}
      renamePlaylist={renamePlaylist}
      deletePlaylist={deletePlaylist}
      addTrackToPlaylist={addTrackToPlaylist}
      removeTrackFromPlaylist={removeTrackFromPlaylist}
      getTrackIdsInPlaylist={getTrackIdsInPlaylist}
      logError={logError}
    >
      {children}
    </VideoPlaylistProvider>
  );
}
