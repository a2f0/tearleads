import { useMultiFileUpload } from '@tearleads/audio';
import {
  DesktopFloatingWindow as FloatingWindow,
  useWindowRefresh,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Loader2, RefreshCw, Upload } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { ClientVideoProvider } from '@/contexts/ClientVideoProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';
import { useDropZone } from '@/hooks/dnd';
import { useFileUpload } from '@/hooks/vfs';
import { isVideoMimeType } from '@/lib/thumbnail';
import { VideoPage } from '@/pages/Video';
import { VideoDetail } from '@/pages/VideoDetail';
import { useVideoPlaylistContext } from '@/video/VideoPlaylistContext';
import { ALL_VIDEO_ID, VideoPlaylistsSidebar } from './VideoPlaylistsSidebar';
import type { ViewMode } from './VideoWindowMenuBar';
import { VideoWindowMenuBar } from './VideoWindowMenuBar';

interface VideoWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function VideoWindow(props: VideoWindowProps) {
  return (
    <ClientVideoProvider>
      <VideoWindowInner {...props} />
    </ClientVideoProvider>
  );
}

function VideoWindowInner({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: VideoWindowProps) {
  const openRequest = useWindowOpenRequest('videos');
  const { addTrackToPlaylist } = useVideoPlaylistContext();
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [autoPlay, setAutoPlay] = useState(false);
  const { refreshToken, triggerRefresh } = useWindowRefresh();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useFileUpload();
  const { uploadMany, uploading, uploadProgress } = useMultiFileUpload({
    uploadFile,
    validateFile: (file) =>
      isVideoMimeType(file.type)
        ? null
        : `"${file.name}" has an unsupported video format. Supported formats: MP4, WebM, OGG, MOV, AVI, MKV, MPEG, 3GP.`
  });
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    ALL_VIDEO_ID
  );

  const handleOpenVideo = useCallback(
    (videoId: string, options?: { autoPlay?: boolean | undefined }) => {
      setActiveVideoId(videoId);
      setAutoPlay(options?.autoPlay ?? false);
    },
    []
  );

  const handleBack = useCallback(() => {
    setActiveVideoId(null);
    setAutoPlay(false);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setActiveVideoId(null);
    setAutoPlay(false);
  }, []);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRefresh = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  // Handler for uploading files with optional target playlist override
  const handleUploadFilesToPlaylist = useCallback(
    async (files: File[], targetPlaylistId?: string | null) => {
      const { results, errors } = await uploadMany(files);
      for (const error of errors) {
        console.error(
          `Failed to upload ${error.fileName}:`,
          new Error(error.message)
        );
      }

      // Use target playlist if provided, otherwise use currently selected playlist
      const playlistToUse = targetPlaylistId ?? selectedPlaylistId;
      if (playlistToUse && playlistToUse !== ALL_VIDEO_ID) {
        await Promise.all(
          results.map(async (result) => {
            try {
              await addTrackToPlaylist(playlistToUse, result.id);
            } catch (error) {
              console.error(
                `Failed to add track ${result.id} to playlist ${playlistToUse}:`,
                error
              );
            }
          })
        );
      }

      if (results.length > 0) {
        triggerRefresh();
      }
    },
    [uploadMany, selectedPlaylistId, addTrackToPlaylist, triggerRefresh]
  );

  // Main content area drop zone
  const { isDragging, dropZoneProps } = useDropZone({
    accept: 'video/*',
    onDrop: handleUploadFilesToPlaylist,
    disabled: uploading
  });

  // Handler for dropping files onto a specific playlist in the sidebar
  const handleDropToPlaylist = useCallback(
    async (playlistId: string, files: File[], videoIds?: string[]) => {
      if (videoIds && videoIds.length > 0) {
        await Promise.all(
          videoIds.map((videoId) => addTrackToPlaylist(playlistId, videoId))
        );
        triggerRefresh();
        return;
      }
      await handleUploadFilesToPlaylist(files, playlistId);
    },
    [addTrackToPlaylist, handleUploadFilesToPlaylist, triggerRefresh]
  );

  // Wrapper for existing upload patterns (no playlist override)
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      await handleUploadFilesToPlaylist(files);
    },
    [handleUploadFilesToPlaylist]
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) {
        void handleUploadFiles(files);
      }
      event.target.value = '';
    },
    [handleUploadFiles]
  );

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.videoId) {
      handleOpenVideo(openRequest.videoId, { autoPlay: false });
    }
    if (openRequest.playlistId) {
      setSelectedPlaylistId(openRequest.playlistId);
    }
  }, [handleOpenVideo, openRequest]);

  const handlePlaylistChanged = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  return (
    <FloatingWindow
      id={id}
      title="Videos"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={400}
      minHeight={300}
    >
      <div className="flex h-full flex-col">
        <VideoWindowMenuBar
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onUpload={handleUpload}
          onClose={onClose}
        />
        <WindowControlBar>
          <WindowControlGroup>
            {activeVideoId ? (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={handleBack}
                data-testid="video-window-control-back"
              >
                Back
              </WindowControlButton>
            ) : (
              <>
                <WindowControlButton
                  icon={<Upload className="h-3 w-3" />}
                  onClick={handleUpload}
                  disabled={uploading}
                  data-testid="video-window-control-upload"
                >
                  Upload
                </WindowControlButton>
                <WindowControlButton
                  icon={<RefreshCw className="h-3 w-3" />}
                  onClick={handleRefresh}
                  disabled={uploading}
                  data-testid="video-window-control-refresh"
                >
                  Refresh
                </WindowControlButton>
              </>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="flex flex-1 overflow-hidden">
          <VideoPlaylistsSidebar
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            selectedPlaylistId={selectedPlaylistId}
            onPlaylistSelect={setSelectedPlaylistId}
            refreshToken={refreshToken}
            onPlaylistChanged={handlePlaylistChanged}
            onDropToPlaylist={handleDropToPlaylist}
          />
          <div className="relative flex-1 overflow-hidden" {...dropZoneProps}>
            {uploading ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-medium">Uploading...</p>
                </div>
                <UploadProgress progress={uploadProgress} />
              </div>
            ) : activeVideoId ? (
              <div className="h-full overflow-auto p-3">
                <VideoDetail
                  videoId={activeVideoId}
                  onBack={handleBack}
                  autoPlay={autoPlay}
                />
              </div>
            ) : (
              <div className="h-full overflow-auto p-3">
                <VideoPage
                  key={refreshToken}
                  onOpenVideo={handleOpenVideo}
                  hideBackLink
                  viewMode={viewMode}
                  onUpload={handleUpload}
                  playlistId={
                    selectedPlaylistId === ALL_VIDEO_ID
                      ? null
                      : selectedPlaylistId
                  }
                />
              </div>
            )}
            <DropZoneOverlay isVisible={isDragging} label="videos" />
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="video-file-input"
      />
    </FloatingWindow>
  );
}
