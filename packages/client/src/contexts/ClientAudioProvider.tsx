/**
 * Client-side AudioUIProvider wrapper that supplies all dependencies
 * to the @tearleads/audio package components.
 */

import {
  type AudioInfo,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioUIComponents,
  AudioUIProvider,
  type AudioWithUrl,
  type NavigateToAudio
} from '@tearleads/audio';
import audioPackageJson from '@tearleads/audio/package.json';
import { assertPlainArrayBuffer } from '@tearleads/shared';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar } from '@/components/ui/ActionToolbar';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { EditableTitle } from '@/components/ui/editable-title';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/ListRow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { useFileUpload } from '@/hooks/vfs';
import { useTypedTranslation } from '@/i18n';
import { extractAudioMetadata as extractMetadata } from '@/lib/audioMetadata';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import { linkAudioToPlaylist } from '@/lib/linkAudioToPlaylist';
import { useNavigateWithFrom } from '@/lib/navigation';
import { detectPlatform, formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { logStore } from '@/stores/logStore';

export function AudioAboutMenuItem() {
  return <AboutMenuItem appName="Audio" version={audioPackageJson.version} />;
}

const audioUIComponents: AudioUIComponents = {
  Button,
  Input,
  ContextMenu,
  ContextMenuItem,
  ListRow,
  RefreshButton,
  VirtualListStatus,
  InlineUnlock,
  EditableTitle,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem: AudioAboutMenuItem,
  BackLink,
  Dropzone,
  ActionToolbar,
  AudioPlayer
};

interface ClientAudioProviderProps {
  children: ReactNode;
}

export function ClientAudioProvider({ children }: ClientAudioProviderProps) {
  const databaseContext = useDatabaseContext();
  const { t } = useTypedTranslation('audio');
  const navigateWithFrom = useNavigateWithFrom();
  const { uploadFile: fileUpload } = useFileUpload();

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

  const navigateToAudio: NavigateToAudio = useCallback(
    (audioId, options) => {
      navigateWithFrom(
        `/audio/${audioId}`,
        options?.fromLabel ? { fromLabel: options.fromLabel } : undefined
      );
    },
    [navigateWithFrom]
  );

  const fetchAudioFiles = useCallback(
    async (
      ids?: string[] | null,
      includeDeleted = false
    ): Promise<AudioInfo[]> => {
      const db = getDatabase();

      if (ids && ids.length === 0) return [];

      const baseConditions = and(
        like(files.mimeType, 'audio/%'),
        includeDeleted ? undefined : eq(files.deleted, false)
      );
      const whereClause =
        ids && ids.length > 0
          ? and(baseConditions, inArray(files.id, ids))
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

      return result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));
    },
    []
  );

  const fetchAudioFilesWithUrls = useCallback(
    async (
      ids?: string[] | null,
      includeDeleted = false
    ): Promise<AudioWithUrl[]> => {
      const audioFiles = await fetchAudioFiles(ids, includeDeleted);

      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!databaseContext.currentInstanceId)
        throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(
          encryptionKey,
          databaseContext.currentInstanceId
        );
      }

      const storage = getFileStorage();
      const db = getDatabase();
      const logger = createRetrieveLogger(db);

      const tracksWithUrls = (
        await Promise.all(
          audioFiles.map(async (track) => {
            try {
              const data = await storage.measureRetrieve(
                track.storagePath,
                logger
              );
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: track.mimeType });
              const objectUrl = URL.createObjectURL(blob);

              let thumbnailUrl: string | null = null;
              if (track.thumbnailPath) {
                try {
                  const thumbData = await storage.measureRetrieve(
                    track.thumbnailPath,
                    logger
                  );
                  assertPlainArrayBuffer(thumbData);
                  const thumbBlob = new Blob([thumbData], {
                    type: 'image/jpeg'
                  });
                  thumbnailUrl = URL.createObjectURL(thumbBlob);
                } catch (err) {
                  logStore.warn(
                    `Failed to load thumbnail for ${track.name}`,
                    String(err)
                  );
                }
              }

              return { ...track, objectUrl, thumbnailUrl };
            } catch (err) {
              logStore.error(`Failed to load track ${track.name}`, String(err));
              return null;
            }
          })
        )
      ).filter((t): t is AudioWithUrl => t !== null);

      return tracksWithUrls;
    },
    [fetchAudioFiles, databaseContext.currentInstanceId]
  );

  const fetchPlaylists = useCallback(async (): Promise<AudioPlaylist[]> => {
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
          eq(playlists.mediaType, 'audio')
        )
      );

    if (playlistRows.length === 0) return [];

    const result: AudioPlaylist[] = playlistRows.map((playlist) => ({
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
      mediaType: 'audio'
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
    async (playlistId: string, audioId: string): Promise<void> => {
      const db = getDatabase();
      await linkAudioToPlaylist(db, playlistId, [audioId]);
    },
    []
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, audioId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .delete(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, playlistId), eq(vfsLinks.childId, audioId))
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

  const retrieveFile = useCallback(
    async (storagePath: string): Promise<ArrayBuffer | Uint8Array> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!databaseContext.currentInstanceId)
        throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(
          encryptionKey,
          databaseContext.currentInstanceId
        );
      }

      const storage = getFileStorage();
      const db = getDatabase();
      const logger = createRetrieveLogger(db);
      return storage.measureRetrieve(storagePath, logger);
    },
    [databaseContext.currentInstanceId]
  );

  const softDeleteAudio = useCallback(
    async (audioId: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, audioId));
    },
    []
  );

  const restoreAudio = useCallback(async (audioId: string): Promise<void> => {
    const db = getDatabase();
    await db.update(files).set({ deleted: false }).where(eq(files.id, audioId));
  }, []);

  const updateAudioName = useCallback(
    async (audioId: string, name: string): Promise<void> => {
      const db = getDatabase();
      await db.update(files).set({ name }).where(eq(files.id, audioId));
    },
    []
  );

  const uploadFile = useCallback(
    async (
      file: File,
      onProgress?: (progress: number) => void
    ): Promise<string> => {
      const result = await fileUpload(file, onProgress);
      return result.id;
    },
    [fileUpload]
  );

  const extractAudioMetadata = useCallback(
    async (
      data: Uint8Array,
      mimeType: string
    ): Promise<AudioMetadata | null> => {
      return extractMetadata(data, mimeType);
    },
    []
  );

  const handleDownloadFile = useCallback(
    (data: Uint8Array, filename: string): void => {
      downloadFile(data, filename);
    },
    []
  );

  const handleShareFile = useCallback(
    async (
      data: Uint8Array,
      filename: string,
      mimeType: string
    ): Promise<boolean> => {
      return shareFile(data, filename, mimeType);
    },
    []
  );

  const logError = useCallback(
    (message: string, details?: string) => logStore.error(message, details),
    []
  );

  const logWarn = useCallback(
    (message: string, details?: string) => logStore.warn(message, details),
    []
  );

  return (
    <AudioUIProvider
      databaseState={databaseState}
      ui={audioUIComponents}
      t={t}
      tooltipZIndex={zIndex.tooltip}
      navigateToAudio={navigateToAudio}
      fetchAudioFiles={fetchAudioFiles}
      fetchAudioFilesWithUrls={fetchAudioFilesWithUrls}
      fetchPlaylists={fetchPlaylists}
      createPlaylist={createPlaylist}
      renamePlaylist={renamePlaylist}
      deletePlaylist={deletePlaylist}
      addTrackToPlaylist={addTrackToPlaylist}
      removeTrackFromPlaylist={removeTrackFromPlaylist}
      getTrackIdsInPlaylist={getTrackIdsInPlaylist}
      retrieveFile={retrieveFile}
      softDeleteAudio={softDeleteAudio}
      restoreAudio={restoreAudio}
      updateAudioName={updateAudioName}
      uploadFile={uploadFile}
      formatFileSize={formatFileSize}
      formatDate={formatDate}
      logError={logError}
      logWarn={logWarn}
      detectPlatform={detectPlatform}
      extractAudioMetadata={extractAudioMetadata}
      downloadFile={handleDownloadFile}
      shareFile={handleShareFile}
      canShareFiles={canShareFiles}
    >
      {children}
    </AudioUIProvider>
  );
}
