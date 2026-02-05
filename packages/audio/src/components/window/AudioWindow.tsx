import { FloatingWindow, type WindowDimensions } from '@rapid/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioUIContext } from '../../context/AudioUIContext';
import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from './AudioPlaylistsSidebar';
import { AudioWindowDetail } from './AudioWindowDetail';
import { AudioWindowList } from './AudioWindowList';
import type { AudioViewMode } from './AudioWindowMenuBar';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';
import { AudioWindowTableView } from './AudioWindowTableView';

interface AudioWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openAudioId?: string | null | undefined;
  openPlaylistId?: string | null | undefined;
  openRequestId?: number | undefined;
}

export function AudioWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions,
  openAudioId,
  openPlaylistId,
  openRequestId
}: AudioWindowProps) {
  const { uploadFile, addTrackToPlaylist, databaseState } = useAudioUIContext();
  const { isUnlocked } = databaseState;

  const [view, setView] = useState<AudioViewMode>('list');
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showDropzone, setShowDropzone] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    ALL_AUDIO_ID
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      const uploadedIds: string[] = [];

      setUploading(true);
      setUploadProgress(0);
      const progresses = Array<number>(files.length).fill(0);
      const updateOverall = () => {
        const total = progresses.reduce((sum, p) => sum + p, 0);
        setUploadProgress(Math.round(total / files.length));
      };

      try {
        await Promise.all(
          files.map(async (file, index) => {
            try {
              const fileId = await uploadFile(file, (progress) => {
                progresses[index] = progress;
                updateOverall();
              });
              uploadedIds.push(fileId);
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          })
        );

        // Add uploaded files to selected playlist if one is selected
        if (selectedPlaylistId && selectedPlaylistId !== ALL_AUDIO_ID) {
          await Promise.all(
            uploadedIds.map((id) => addTrackToPlaylist(selectedPlaylistId, id))
          );
        }

        setRefreshToken((value) => value + 1);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [uploadFile, selectedPlaylistId, addTrackToPlaylist]
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

  useEffect(() => {
    if (!openRequestId) return;
    if (openAudioId) {
      setSelectedTrackId(openAudioId);
    }
    if (openPlaylistId) {
      setSelectedPlaylistId(openPlaylistId);
    }
  }, [openAudioId, openPlaylistId, openRequestId]);

  return (
    <FloatingWindow
      id={id}
      title="Audio"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={450}
      defaultHeight={500}
      minWidth={350}
      minHeight={350}
    >
      <div className="flex h-full flex-col">
        <AudioWindowMenuBar
          onClose={onClose}
          onUpload={handleUpload}
          view={view}
          onViewChange={setView}
          showDropzone={showDropzone}
          onShowDropzoneChange={setShowDropzone}
        />
        <div className="flex flex-1 overflow-hidden">
          {isUnlocked && (
            <AudioPlaylistsSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              selectedPlaylistId={selectedPlaylistId}
              onPlaylistSelect={setSelectedPlaylistId}
              refreshToken={refreshToken}
              onPlaylistChanged={handlePlaylistChanged}
            />
          )}
          <div className="flex-1 overflow-hidden">
            {selectedTrackId ? (
              <AudioWindowDetail
                audioId={selectedTrackId}
                onBack={handleBack}
                onDeleted={handleDeleted}
              />
            ) : view === 'list' ? (
              <AudioWindowList
                onSelectTrack={handleSelectTrack}
                refreshToken={refreshToken}
                showDropzone={showDropzone}
                onUploadFiles={handleUploadFiles}
                selectedPlaylistId={selectedPlaylistId}
                uploading={uploading}
                uploadProgress={uploadProgress}
              />
            ) : (
              <AudioWindowTableView
                onSelectTrack={handleSelectTrack}
                refreshToken={refreshToken}
                selectedPlaylistId={selectedPlaylistId}
              />
            )}
          </div>
        </div>
      </div>
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
