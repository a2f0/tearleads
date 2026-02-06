import { Loader2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { UploadProgress } from '@/components/ui/upload-progress';
import { ClientVideoProvider } from '@/contexts/ClientVideoProvider';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useFileUpload } from '@/hooks/useFileUpload';
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
  onFocus,
  zIndex,
  initialDimensions
}: VideoWindowProps) {
  const { windowOpenRequests } = useWindowManager();
  const { addTrackToPlaylist } = useVideoPlaylistContext();
  const openRequest = windowOpenRequests.videos;
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [autoPlay, setAutoPlay] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile } = useFileUpload();
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
            if (!isVideoMimeType(file.type)) {
              console.error(
                `Failed to upload ${file.name}:`,
                new Error(
                  `"${file.name}" has an unsupported video format. Supported formats: MP4, WebM, OGG, MOV, AVI, MKV, MPEG, 3GP.`
                )
              );
              return;
            }

            try {
              const result = await uploadFile(file, (progress) => {
                progresses[index] = progress;
                updateOverall();
              });
              uploadedIds.push(result.id);
            } catch (err) {
              console.error(`Failed to upload ${file.name}:`, err);
            }
          })
        );

        // Add uploaded files to selected playlist if one is selected
        if (selectedPlaylistId && selectedPlaylistId !== ALL_VIDEO_ID) {
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
    setRefreshToken((value) => value + 1);
  }, []);

  return (
    <FloatingWindow
      id={id}
      title="Videos"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
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
        <div className="flex flex-1 overflow-hidden">
          <VideoPlaylistsSidebar
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            selectedPlaylistId={selectedPlaylistId}
            onPlaylistSelect={setSelectedPlaylistId}
            refreshToken={refreshToken}
            onPlaylistChanged={handlePlaylistChanged}
          />
          <div className="flex-1 overflow-hidden">
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
