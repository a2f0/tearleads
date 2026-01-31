/**
 * Client-side AudioUIProvider wrapper that supplies all dependencies
 * to the @rapid/audio package components.
 */

import {
  type AudioInfo,
  type AudioMetadata,
  type AudioPlaylist,
  type AudioUIComponents,
  AudioUIProvider,
  type AudioWithUrl,
  type NavigateToAudio
} from '@rapid/audio';
import audioPackageJson from '@rapid/audio/package.json';
import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { type ReactNode, useCallback } from 'react';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar } from '@/components/ui/action-toolbar';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { EditableTitle } from '@/components/ui/editable-title';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { zIndex } from '@/constants/zIndex';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, playlists, vfsLinks, vfsRegistry } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useTypedTranslation } from '@/i18n';
import { extractAudioMetadata as extractMetadata } from '@/lib/audio-metadata';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
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

  const databaseState = {
    isUnlocked: databaseContext.isUnlocked,
    isLoading: databaseContext.isLoading,
    currentInstanceId: databaseContext.currentInstanceId
  };

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
    async (ids?: string[] | null): Promise<AudioInfo[]> => {
      const db = getDatabase();

      if (ids && ids.length === 0) return [];

      const baseConditions = and(
        like(files.mimeType, 'audio/%'),
        eq(files.deleted, false)
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
          thumbnailPath: files.thumbnailPath
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
        thumbnailPath: row.thumbnailPath
      }));
    },
    []
  );

  const fetchAudioFilesWithUrls = useCallback(
    async (ids?: string[] | null): Promise<AudioWithUrl[]> => {
      const audioFiles = await fetchAudioFiles(ids);

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

    const playlistRows = await db
      .select({
        id: vfsRegistry.id,
        name: playlists.encryptedName,
        coverImageId: playlists.coverImageId
      })
      .from(vfsRegistry)
      .innerJoin(playlists, eq(playlists.id, vfsRegistry.id))
      .where(eq(vfsRegistry.objectType, 'playlist'));

    if (playlistRows.length === 0) return [];

    const playlistIds = playlistRows.map((row) => row.id);

    const childCountRows = await db
      .select({ parentId: vfsLinks.parentId })
      .from(vfsLinks)
      .where(inArray(vfsLinks.parentId, playlistIds));

    const trackCountMap = new Map<string, number>();
    for (const row of childCountRows) {
      trackCountMap.set(
        row.parentId,
        (trackCountMap.get(row.parentId) || 0) + 1
      );
    }

    const result: AudioPlaylist[] = playlistRows.map((playlist) => ({
      id: playlist.id,
      name: playlist.name || 'Unnamed Playlist',
      trackCount: trackCountMap.get(playlist.id) || 0,
      coverImageId: playlist.coverImageId
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
      createdAt: now
    });

    await db.insert(playlists).values({
      id: playlistId,
      encryptedName: name,
      encryptedDescription: null,
      coverImageId: null,
      shuffleMode: 0
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
      const linkId = crypto.randomUUID();
      const now = new Date();

      const existing = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(
          and(eq(vfsLinks.parentId, playlistId), eq(vfsLinks.childId, audioId))
        );

      if (existing.length > 0) return;

      await db.insert(vfsLinks).values({
        id: linkId,
        parentId: playlistId,
        childId: audioId,
        wrappedSessionKey: '',
        createdAt: now
      });
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

  const updateAudioName = useCallback(
    async (audioId: string, name: string): Promise<void> => {
      const db = getDatabase();
      await db.update(files).set({ name }).where(eq(files.id, audioId));
    },
    []
  );

  const uploadFile = useCallback(
    async (file: File): Promise<void> => {
      await fileUpload(file);
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
      updateAudioName={updateAudioName}
      uploadFile={uploadFile}
      formatFileSize={formatFileSize}
      formatDate={formatDate}
      logError={logStore.error.bind(logStore)}
      logWarn={logStore.warn.bind(logStore)}
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
