import {
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  WindowSidebar,
  WindowSidebarToggle
} from '@tearleads/window-manager';
import { ArrowLeft, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropZoneOverlay } from '../DropZoneOverlay';
import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from './AudioPlaylistsSidebar';
import { AudioWindowDetail } from './AudioWindowDetail';
import { AudioWindowList } from './AudioWindowList';
import type { AudioViewMode } from './AudioWindowMenuBar';
import { AudioWindowMenuBar } from './AudioWindowMenuBar';
import { AudioWindowTableView } from './AudioWindowTableView';

interface AudioWindowContentProps {
  onClose: () => void;
  onUpload: () => void;
  onRefresh: () => void;
  view: AudioViewMode;
  onViewChange: (view: AudioViewMode) => void;
  showDeleted: boolean;
  onShowDeletedChange: (showDeleted: boolean) => void;
  showDropzone: boolean;
  onShowDropzoneChange: (showDropzone: boolean) => void;
  isUnlocked: boolean;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  selectedPlaylistId: string | null;
  onPlaylistSelect: (playlistId: string | null) => void;
  selectedAlbumId: string | null;
  onAlbumSelect: (albumId: string | null) => void;
  refreshToken: number;
  onPlaylistChanged: () => void;
  onDropToPlaylist: (
    playlistId: string,
    files: File[],
    audioIds?: string[]
  ) => Promise<void>;
  dropZoneProps: React.HTMLAttributes<HTMLDivElement>;
  selectedTrackId: string | null;
  onBack: () => void;
  onDeleted: () => void;
  onSelectTrack: (trackId: string) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  uploading: boolean;
  uploadProgress: number;
  isDragging: boolean;
}

export function AudioWindowContent({
  onClose,
  onUpload,
  onRefresh,
  view,
  onViewChange,
  showDeleted,
  onShowDeletedChange,
  showDropzone,
  onShowDropzoneChange,
  isUnlocked,
  sidebarWidth,
  onSidebarWidthChange,
  selectedPlaylistId,
  onPlaylistSelect,
  selectedAlbumId,
  onAlbumSelect,
  refreshToken,
  onPlaylistChanged,
  onDropToPlaylist,
  dropZoneProps,
  selectedTrackId,
  onBack,
  onDeleted,
  onSelectTrack,
  onUploadFiles,
  uploading,
  uploadProgress,
  isDragging
}: AudioWindowContentProps) {
  const { t } = useTranslation('audio');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <AudioWindowMenuBar
        onClose={onClose}
        onUpload={onUpload}
        view={view}
        onViewChange={onViewChange}
        showDeleted={showDeleted}
        onShowDeletedChange={onShowDeletedChange}
        showDropzone={showDropzone}
        onShowDropzoneChange={onShowDropzoneChange}
      />
      <WindowControlBar>
        <WindowControlGroup>
          <WindowSidebarToggle
            onToggle={() => setSidebarOpen((prev) => !prev)}
          />
          {selectedTrackId ? (
            <WindowControlButton
              icon={<ArrowLeft className="h-3 w-3" />}
              onClick={onBack}
              data-testid="audio-window-control-back"
            >
              {t('back')}
            </WindowControlButton>
          ) : (
            <>
              <WindowControlButton
                icon={<Upload className="h-3 w-3" />}
                onClick={onUpload}
                disabled={uploading}
                data-testid="audio-window-control-upload"
              >
                Upload
              </WindowControlButton>
              <WindowControlButton
                icon={<RefreshCw className="h-3 w-3" />}
                onClick={onRefresh}
                disabled={uploading}
                data-testid="audio-window-control-refresh"
              >
                Refresh
              </WindowControlButton>
            </>
          )}
        </WindowControlGroup>
      </WindowControlBar>
      <div className="flex min-h-0 flex-1">
        {isUnlocked && (
          <WindowSidebar
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            ariaLabel={t('playlists')}
            data-testid="audio-playlists-sidebar"
          >
            <AudioPlaylistsSidebar
              selectedPlaylistId={selectedPlaylistId}
              onPlaylistSelect={onPlaylistSelect}
              selectedAlbumId={selectedAlbumId}
              onAlbumSelect={onAlbumSelect}
              refreshToken={refreshToken}
              onPlaylistChanged={onPlaylistChanged}
              onDropToPlaylist={onDropToPlaylist}
            />
          </WindowSidebar>
        )}
        <div
          className="relative min-h-0 flex-1 overflow-y-auto"
          {...dropZoneProps}
        >
          {selectedTrackId ? (
            <AudioWindowDetail
              audioId={selectedTrackId}
              onBack={onBack}
              onDeleted={onDeleted}
            />
          ) : view === 'list' ? (
            <AudioWindowList
              onSelectTrack={onSelectTrack}
              refreshToken={refreshToken}
              showDropzone={showDropzone}
              onUploadFiles={onUploadFiles}
              selectedPlaylistId={selectedPlaylistId}
              selectedAlbumId={selectedAlbumId}
              onAlbumSelect={onAlbumSelect}
              uploading={uploading}
              uploadProgress={uploadProgress}
              onUpload={onUpload}
              showDeleted={showDeleted}
            />
          ) : (
            <AudioWindowTableView
              onSelectTrack={onSelectTrack}
              refreshToken={refreshToken}
              selectedPlaylistId={selectedPlaylistId}
              selectedAlbumId={selectedAlbumId}
              onAlbumSelect={onAlbumSelect}
              showDeleted={showDeleted}
            />
          )}
          <DropZoneOverlay isVisible={isDragging} label={t('audioTracks')} />
        </div>
      </div>
    </div>
  );
}

export { ALL_AUDIO_ID };
