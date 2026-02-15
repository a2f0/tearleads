import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { Film, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, vfsLinks } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useNavigateWithFrom } from '@/lib/navigation';
import { detectPlatform } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/mpeg',
  'video/3gpp',
  'video/3gpp2'
];

export interface VideoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export interface VideoWithThumbnail extends VideoInfo {
  thumbnailUrl: string | null;
}

type ViewMode = 'list' | 'table';

export interface VideoOpenOptions {
  autoPlay?: boolean | undefined;
}

interface VideoPageProps {
  onOpenVideo?:
    | ((videoId: string, options?: VideoOpenOptions) => void)
    | undefined;
  hideBackLink?: boolean | undefined;
  viewMode?: ViewMode | undefined;
  playlistId?: string | null | undefined;
  onUpload?: (() => void) | undefined;
}

export function VideoPage({
  onOpenVideo,
  hideBackLink = false,
  viewMode = 'list',
  playlistId = null,
  onUpload
}: VideoPageProps) {
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [videos, setVideos] = useState<VideoWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const parentRef = useRef<HTMLDivElement>(null);
  const tableParentRef = useRef<HTMLDivElement>(null);

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, []);

  const fetchVideos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // If a playlist is selected, get the video IDs in that playlist
      let videoIdsInPlaylist: string[] | null = null;
      if (playlistId) {
        const links = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, playlistId));
        videoIdsInPlaylist = links.map((link) => link.childId);

        // If playlist is empty, return early
        if (videoIdsInPlaylist.length === 0) {
          setVideos([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      const baseConditions = and(
        like(files.mimeType, 'video/%'),
        eq(files.deleted, false)
      );
      const whereClause = videoIdsInPlaylist
        ? and(baseConditions, inArray(files.id, videoIdsInPlaylist))
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

      const videoList: VideoInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      // Load video data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      // Only load thumbnails, not full video data - video content is loaded on demand in VideoDetail
      const videosWithThumbnails = await Promise.all(
        videoList.map(async (video) => {
          let thumbnailUrl: string | null = null;
          if (video.thumbnailPath) {
            try {
              const thumbData = await storage.measureRetrieve(
                video.thumbnailPath,
                logger
              );
              assertPlainArrayBuffer(thumbData);
              const thumbBlob = new Blob([thumbData], {
                type: 'image/jpeg'
              });
              thumbnailUrl = URL.createObjectURL(thumbBlob);
            } catch (err) {
              console.warn(`Failed to load thumbnail for ${video.name}:`, err);
            }
          }
          return { ...video, thumbnailUrl };
        })
      );

      setVideos(videosWithThumbnails);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch videos:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, playlistId]);

  // Track the instance ID for which we've fetched videos
  const fetchedForInstanceRef = useRef<string | null>(null);
  const fetchedForPlaylistRef = useRef<string | null | undefined>(undefined);

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        for (const file of selectedFiles) {
          // Validate that the file type is one of the supported video MIME types
          if (!VIDEO_MIME_TYPES.includes(file.type)) {
            throw new Error(
              `"${file.name}" has an unsupported video format. Supported formats: MP4, WebM, OGG, MOV, AVI, MKV, MPEG, 3GP.`
            );
          }

          await uploadFile(file, setUploadProgress);
        }

        // Refresh videos after successful upload
        setHasFetched(false);
      } catch (err) {
        console.error('Failed to upload file:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [uploadFile]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: videos intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance or playlist
    const instanceChanged = fetchedForInstanceRef.current !== currentInstanceId;
    const playlistChanged = fetchedForPlaylistRef.current !== playlistId;
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || instanceChanged || playlistChanged);

    if (needsFetch) {
      // If instance or playlist changed, cleanup old thumbnail URLs first
      if (
        (instanceChanged || playlistChanged) &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const video of videos) {
          if (video.thumbnailUrl) {
            URL.revokeObjectURL(video.thumbnailUrl);
          }
        }
        setVideos([]);
        setError(null);
      }

      // Update refs before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;
      fetchedForPlaylistRef.current = playlistId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchVideos();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    playlistId,
    fetchVideos
  ]);

  // Cleanup thumbnail URLs on unmount
  useEffect(() => {
    return () => {
      for (const v of videos) {
        if (v.thumbnailUrl) {
          URL.revokeObjectURL(v.thumbnailUrl);
        }
      }
    };
  }, [videos]);

  const handleNavigateToDetail = useCallback(
    (videoId: string, options?: VideoOpenOptions) => {
      if (onOpenVideo) {
        onOpenVideo(videoId, options);
        return;
      }
      const navigationOptions: {
        fromLabel: string;
        state?: Record<string, unknown>;
      } = { fromLabel: 'Back to Videos' };
      if (options?.autoPlay) {
        navigationOptions.state = { autoPlay: true };
      }
      navigateWithFrom(`/videos/${videoId}`, navigationOptions);
    },
    [navigateWithFrom, onOpenVideo]
  );

  const handlePlay = useCallback(
    (video: VideoWithThumbnail) => {
      handleNavigateToDetail(video.id, { autoPlay: true });
    },
    [handleNavigateToDetail]
  );

  const handleGetInfo = useCallback(
    (video: VideoWithThumbnail) => {
      handleNavigateToDetail(video.id);
    },
    [handleNavigateToDetail]
  );

  const handleDelete = useCallback(
    async (videoToDelete: VideoWithThumbnail) => {
      try {
        const db = getDatabase();

        // Soft delete
        await db
          .update(files)
          .set({ deleted: true })
          .where(eq(files.id, videoToDelete.id));

        // Remove from list and revoke thumbnail URL
        setVideos((prev) => {
          const remaining = prev.filter((v) => v.id !== videoToDelete.id);
          // Revoke the deleted video's thumbnail URL
          if (videoToDelete.thumbnailUrl) {
            URL.revokeObjectURL(videoToDelete.thumbnailUrl);
          }
          return remaining;
        });
      } catch (err) {
        console.error('Failed to delete video:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

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
