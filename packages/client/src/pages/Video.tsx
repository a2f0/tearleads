import { assertPlainArrayBuffer } from '@rapid/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { and, desc, eq, like } from 'drizzle-orm';
import { ChevronRight, Film, Info, Loader2, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useVirtualVisibleRange } from '@/hooks/useVirtualVisibleRange';
import { useTypedTranslation } from '@/i18n';
import { useNavigateWithFrom } from '@/lib/navigation';
import { detectPlatform, formatDate, formatFileSize } from '@/lib/utils';
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

interface VideoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

interface VideoWithThumbnail extends VideoInfo {
  thumbnailUrl: string | null;
}

type ViewMode = 'list' | 'table';

const ROW_HEIGHT_ESTIMATE = 56;

function getVideoTypeDisplay(mimeType: string): string {
  if (!mimeType) return 'Video';
  const [, subtype] = mimeType.split('/');
  if (subtype) {
    return subtype.toUpperCase();
  }
  return 'Video';
}

interface VideoPageProps {
  onOpenVideo?: ((videoId: string) => void) | undefined;
  hideBackLink?: boolean | undefined;
  viewMode?: ViewMode | undefined;
}

export function VideoPage({
  onOpenVideo,
  hideBackLink = false,
  viewMode = 'list'
}: VideoPageProps) {
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const [videos, setVideos] = useState<VideoWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const parentRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    video: VideoWithThumbnail;
    x: number;
    y: number;
  } | null>(null);

  const virtualizer = useVirtualizer({
    count: videos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

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
        .where(and(like(files.mimeType, 'video/%'), eq(files.deleted, false)))
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
  }, [isUnlocked, currentInstanceId]);

  // Track the instance ID for which we've fetched videos
  const fetchedForInstanceRef = useRef<string | null>(null);

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
    // Check if we need to fetch for this instance
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      // If instance changed, cleanup old thumbnail URLs first
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
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

      // Update ref before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchVideos();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchVideos]);

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
    (videoId: string) => {
      if (onOpenVideo) {
        onOpenVideo(videoId);
        return;
      }
      navigateWithFrom(`/videos/${videoId}`, {
        fromLabel: 'Back to Videos'
      });
    },
    [navigateWithFrom, onOpenVideo]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, video: VideoWithThumbnail) => {
      e.preventDefault();
      setContextMenu({ video, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGetInfo = useCallback(
    (video: VideoWithThumbnail) => {
      navigateWithFrom(`/videos/${video.id}`, {
        fromLabel: 'Back to Videos'
      });
      setContextMenu(null);
    },
    [navigateWithFrom]
  );

  const handleDelete = useCallback(
    async (videoToDelete: VideoWithThumbnail) => {
      setContextMenu(null);

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
              <p className="text-muted-foreground text-sm">
                {uploadProgress}% complete
              </p>
            </div>
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
              <>
                <VirtualListStatus
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  loadedCount={videos.length}
                  itemLabel="video"
                />
                <div className="flex-1 rounded-lg border">
                  <div ref={parentRef} className="h-full overflow-auto">
                    <div
                      className="relative w-full"
                      style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                      {virtualItems.map((virtualItem) => {
                        const video = videos[virtualItem.index];
                        if (!video) return null;

                        return (
                          <div
                            key={video.id}
                            data-index={virtualItem.index}
                            ref={virtualizer.measureElement}
                            className="absolute top-0 left-0 w-full px-1 py-0.5"
                            style={{
                              transform: `translateY(${virtualItem.start}px)`
                            }}
                          >
                            <ListRow
                              data-testid={`video-item-${video.id}`}
                              onContextMenu={(e) => handleContextMenu(e, video)}
                            >
                              <button
                                type="button"
                                onClick={
                                  isDesktopPlatform
                                    ? undefined
                                    : () => handleNavigateToDetail(video.id)
                                }
                                onDoubleClick={
                                  isDesktopPlatform
                                    ? () => handleNavigateToDetail(video.id)
                                    : undefined
                                }
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                                data-testid={`video-open-${video.id}`}
                              >
                                <div className="relative shrink-0">
                                  {video.thumbnailUrl ? (
                                    <img
                                      src={video.thumbnailUrl}
                                      alt=""
                                      className="h-8 w-8 rounded object-cover"
                                    />
                                  ) : (
                                    <Film className="h-5 w-5 text-muted-foreground" />
                                  )}
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-black/50">
                                      <Play className="h-2 w-2 text-white" />
                                    </div>
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-sm">
                                    {video.name}
                                  </p>
                                  <p className="text-muted-foreground text-xs">
                                    {formatFileSize(video.size)}
                                  </p>
                                </div>
                              </button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => handleNavigateToDetail(video.id)}
                                aria-label="View details"
                              >
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </ListRow>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Size</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Uploaded
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video) => (
                      <tr
                        key={video.id}
                        className="cursor-pointer border-t hover:bg-muted/30"
                        onContextMenu={(e) => handleContextMenu(e, video)}
                        onClick={
                          isDesktopPlatform
                            ? undefined
                            : () => handleNavigateToDetail(video.id)
                        }
                        onDoubleClick={
                          isDesktopPlatform
                            ? () => handleNavigateToDetail(video.id)
                            : undefined
                        }
                      >
                        <td className="px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {video.thumbnailUrl ? (
                              <img
                                src={video.thumbnailUrl}
                                alt=""
                                className="h-6 w-6 rounded object-cover"
                              />
                            ) : (
                              <Film className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="truncate font-medium">
                              {video.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatFileSize(video.size)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {getVideoTypeDisplay(video.mimeType)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(video.uploadDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Play className="h-4 w-4" />}
            onClick={() => handleGetInfo(contextMenu.video)}
          >
            {t('play')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => handleGetInfo(contextMenu.video)}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => handleDelete(contextMenu.video)}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
