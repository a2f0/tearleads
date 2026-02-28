import {
  FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAudioUIContext } from '../../context/AudioUIContext';
import { useDropZone } from '../../hooks/useDropZone';
import { useMultiFileUpload } from '../../hooks/useMultiFileUpload';
import { isValidAlbumId } from '../../lib/albumUtils';
import { ALL_AUDIO_ID, AudioWindowContent } from './AudioWindowContent';
import type { AudioViewMode } from './AudioWindowMenuBar';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openAudioId?: string | null | undefined;
  openPlaylistId?: string | null | undefined;
  openAlbumId?: string | null | undefined;
  openRequestId?: number | undefined;
}

export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  openAudioId,
  openPlaylistId,
  openAlbumId,
  openRequestId
}: AudioWindowProps) {
  const { t } = useTranslation('audio');
  const { uploadFile, addTrackToPlaylist, databaseState } = useAudioUIContext();
  const { isUnlocked } = databaseState;

  const [view, setView] = useState<AudioViewMode>('list');
  const [showDeleted, setShowDeleted] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showDropzone, setShowDropzone] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    ALL_AUDIO_ID
  );
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadMany, uploading, uploadProgress } = useMultiFileUpload({
    uploadFile
  });

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleUploadFilesToPlaylist = useCallback(
    async (files: File[], targetPlaylistId?: string | null) => {
      const { results, errors } = await uploadMany(files);
      for (const error of errors) {
        console.error(`Failed to upload ${error.fileName}:`, error.message);
      }

      const playlistToUse = targetPlaylistId ?? selectedPlaylistId;
      if (playlistToUse && playlistToUse !== ALL_AUDIO_ID) {
        await Promise.all(
          results.map(async (fileId) => {
            try {
              await addTrackToPlaylist(playlistToUse, fileId);
            } catch (error) {
              console.error(
                `Failed to add track ${fileId} to playlist ${playlistToUse}:`,
                error
              );
            }
          })
        );
      }

      if (results.length > 0) {
        setRefreshToken((value) => value + 1);
      }
    },
    [uploadMany, selectedPlaylistId, addTrackToPlaylist]
  );

  const { isDragging, dropZoneProps } = useDropZone({
    accept: 'audio/*',
    onDrop: handleUploadFilesToPlaylist,
    disabled: !isUnlocked || uploading
  });

  const handleDropToPlaylist = useCallback(
    async (playlistId: string, files: File[], audioIds?: string[]) => {
      if (audioIds && audioIds.length > 0) {
        await Promise.all(
          audioIds.map((audioId) => addTrackToPlaylist(playlistId, audioId))
        );
        setRefreshToken((value) => value + 1);
        return;
      }
      await handleUploadFilesToPlaylist(files, playlistId);
    },
    [addTrackToPlaylist, handleUploadFilesToPlaylist]
  );

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      await handleUploadFilesToPlaylist(files);
    },
    [handleUploadFilesToPlaylist]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        void handleUploadFiles(files);
      }
      e.target.value = '';
    },
    [handleUploadFiles]
  );

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTrackId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedTrackId(null);
    setRefreshToken((value) => value + 1);
  }, []);

  const handlePlaylistChanged = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handlePlaylistSelect = useCallback((playlistId: string | null) => {
    setSelectedPlaylistId(playlistId);
    if (playlistId && playlistId !== ALL_AUDIO_ID) {
      setSelectedAlbumId(null);
    }
  }, []);

  const handleAlbumSelect = useCallback((albumId: string | null) => {
    setSelectedAlbumId(albumId);
    if (albumId) {
      setSelectedPlaylistId(ALL_AUDIO_ID);
    }
  }, []);

  useEffect(() => {
    if (!openRequestId) return;
    if (openAudioId) {
      setSelectedTrackId(openAudioId);
    }
    if (openAlbumId && isValidAlbumId(openAlbumId)) {
      setSelectedAlbumId(openAlbumId);
      setSelectedPlaylistId(ALL_AUDIO_ID);
    } else if (openPlaylistId) {
      setSelectedPlaylistId(openPlaylistId);
      setSelectedAlbumId(null);
    }
  }, [openAudioId, openPlaylistId, openAlbumId, openRequestId]);

  return (
    <FloatingWindow
      id={id}
      title={t('audio')}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={450}
      defaultHeight={500}
      minWidth={350}
      minHeight={350}
    >
      <AudioWindowContent
        onClose={onClose}
        onUpload={handleUpload}
        onRefresh={handleRefresh}
        view={view}
        onViewChange={setView}
        showDeleted={showDeleted}
        onShowDeletedChange={setShowDeleted}
        showDropzone={showDropzone}
        onShowDropzoneChange={setShowDropzone}
        isUnlocked={isUnlocked}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        selectedPlaylistId={selectedPlaylistId}
        onPlaylistSelect={handlePlaylistSelect}
        selectedAlbumId={selectedAlbumId}
        onAlbumSelect={handleAlbumSelect}
        refreshToken={refreshToken}
        onPlaylistChanged={handlePlaylistChanged}
        onDropToPlaylist={handleDropToPlaylist}
        dropZoneProps={dropZoneProps}
        selectedTrackId={selectedTrackId}
        onBack={handleBack}
        onDeleted={handleDeleted}
        onSelectTrack={handleSelectTrack}
        onUploadFiles={handleUploadFiles}
        uploading={uploading}
        uploadProgress={uploadProgress}
        isDragging={isDragging}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple={false}
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="audio-file-input"
      />
    </FloatingWindow>
  );
}
