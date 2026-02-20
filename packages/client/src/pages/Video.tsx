import { and, eq, inArray } from 'drizzle-orm';
import { Film, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { VideoListView } from '@/components/video-window/VideoListView';
import {
  ALL_VIDEO_ID,
  VideoPlaylistsSidebar
} from '@/components/video-window/VideoPlaylistsSidebar';
import { VideoTableView } from '@/components/video-window/VideoTableView';
import { ClientVideoProvider } from '@/contexts/ClientVideoProvider';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { vfsLinks } from '@/db/schema';
import { detectPlatform } from '@/lib/utils';
import type { VideoPageProps } from './video-components/types';
import { useVideoActions } from './video-components/useVideoActions';
import { useVideoData } from './video-components/useVideoData';
import { useVideoUpload } from './video-components/useVideoUpload';

export type {
  VideoInfo,
  VideoOpenOptions,
  VideoWithThumbnail
} from './video-components/types';

export function VideoPage({
  onOpenVideo,
  hideBackLink = false,
  viewMode = 'list',
  playlistId = null,
  onUpload
}: VideoPageProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const parentRef = useRef<HTMLDivElement>(null);
  const tableParentRef = useRef<HTMLDivElement>(null);

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, []);

  const {
    videos,
    setVideos,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchVideos
  } = useVideoData(playlistId);

  const { uploading, uploadProgress, handleFilesSelected } = useVideoUpload(
    setError,
    setHasFetched
  );

  const { handleNavigateToDetail, handlePlay, handleGetInfo, handleDelete } =
    useVideoActions(setVideos, setError, onOpenVideo);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {!hideBackLink && (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Film className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Videos</h1>
          </div>
          {isUnlocked && (
            <RefreshButton onClick={fetchVideos} loading={loading} />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="videos" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading videos...
          </div>
        ) : uploading ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Uploading...</p>
            </div>
            <UploadProgress progress={uploadProgress} />
          </div>
        ) : videos.length === 0 && hasFetched ? (
          <div className="space-y-4">
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="video/*"
              multiple={false}
              disabled={uploading}
            />
            {isDesktopPlatform && (
              <p className="text-center text-muted-foreground text-sm">
                Drop a video file here to add it to your library
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            {viewMode === 'list' ? (
              <VideoListView
                videos={videos}
                parentRef={parentRef}
                isDesktopPlatform={isDesktopPlatform}
                onNavigateToDetail={handleNavigateToDetail}
                onPlay={handlePlay}
                onGetInfo={handleGetInfo}
                onDelete={handleDelete}
                onUpload={onUpload}
              />
            ) : (
              <VideoTableView
                videos={videos}
                tableParentRef={tableParentRef}
                isDesktopPlatform={isDesktopPlatform}
                onNavigateToDetail={handleNavigateToDetail}
                onPlay={handlePlay}
                onGetInfo={handleGetInfo}
                onDelete={handleDelete}
                onUpload={onUpload}
              />
            )}
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="video/*"
              multiple={false}
              disabled={uploading}
              label="video files"
              source="media"
              compact
              variant="row"
            />
          </div>
        ))}
    </div>
  );
}

function VideoWithSidebar() {
  const { playlistId } = useParams<{ playlistId?: string }>();
  const navigate = useNavigate();
  const { isUnlocked } = useDatabaseContext();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [refreshToken, setRefreshToken] = useState(0);

  // Derive selected playlist from URL (or ALL_VIDEO_ID if no param)
  const selectedPlaylistId = playlistId ?? ALL_VIDEO_ID;

  // Navigate on playlist selection
  const handlePlaylistSelect = useCallback(
    (id: string | null) => {
      if (id === ALL_VIDEO_ID || id === null) {
        navigate('/videos');
      } else {
        navigate(`/videos/playlists/${id}`);
      }
    },
    [navigate]
  );

  const handleDropToPlaylist = useCallback(
    async (
      targetPlaylistId: string,
      droppedFiles: File[],
      videoIds?: string[]
    ) => {
      void droppedFiles;
      if (!videoIds || videoIds.length === 0) return;
      const db = getDatabase();
      const uniqueVideoIds = Array.from(new Set(videoIds));
      const existingLinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(
          and(
            eq(vfsLinks.parentId, targetPlaylistId),
            inArray(vfsLinks.childId, uniqueVideoIds)
          )
        );

      const existingChildIds = new Set(
        existingLinks.map((link) => link.childId)
      );
      const newVideoIds = uniqueVideoIds.filter(
        (id) => !existingChildIds.has(id)
      );

      if (newVideoIds.length > 0) {
        await db.insert(vfsLinks).values(
          newVideoIds.map((videoId) => ({
            id: crypto.randomUUID(),
            parentId: targetPlaylistId,
            childId: videoId,
            wrappedSessionKey: '',
            createdAt: new Date()
          }))
        );
      }
      setRefreshToken((value) => value + 1);
    },
    []
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <BackLink defaultTo="/" defaultLabel="Back to Home" />
      <div className="flex min-h-0 flex-1">
        {isUnlocked && (
          <div className="hidden md:block">
            <VideoPlaylistsSidebar
              width={sidebarWidth}
              onWidthChange={setSidebarWidth}
              selectedPlaylistId={selectedPlaylistId}
              onPlaylistSelect={handlePlaylistSelect}
              refreshToken={refreshToken}
              onPlaylistChanged={() => setRefreshToken((t) => t + 1)}
              onDropToPlaylist={handleDropToPlaylist}
            />
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-hidden md:pl-4">
          <VideoPage
            hideBackLink
            playlistId={
              selectedPlaylistId === ALL_VIDEO_ID ? null : selectedPlaylistId
            }
          />
        </div>
      </div>
    </div>
  );
}

export function Video() {
  return (
    <ClientVideoProvider>
      <VideoWithSidebar />
    </ClientVideoProvider>
  );
}
