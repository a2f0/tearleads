import { and, eq, like } from 'drizzle-orm';
import {
  Calendar,
  FileType,
  Film,
  HardDrive,
  Loader2,
  Pause,
  Play
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar, type ActionType } from '@/components/ui/action-toolbar';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { EditableTitle } from '@/components/ui/editable-title';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized,
  type RetrieveMetrics
} from '@/storage/opfs';
import { useVideo } from '@/video';

interface VideoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const {
    currentVideo,
    isPlaying,
    play,
    pause,
    resume,
    error: videoError,
    clearError
  } = useVideo();
  const currentVideoRef = useRef(currentVideo);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);

  // Track all created blob URLs to revoke on unmount.
  const urlsToRevoke = useRef<string[]>([]);
  const objectUrlRef = useRef<string | null>(null);

  const isCurrentVideo = currentVideo?.id === id;
  const isVideoPlaying = isCurrentVideo && isPlaying;

  // Check if Web Share API is available on mount
  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  // Handle video playback errors from context
  useEffect(() => {
    if (videoError && videoError.trackId === id) {
      setError(videoError.message);
      clearError();
    }
  }, [videoError, id, clearError]);

  // Helper to retrieve and decrypt file data from storage
  const retrieveFileData = useCallback(
    async (
      storagePath: string,
      onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
    ): Promise<Uint8Array> => {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      return storage.measureRetrieve(storagePath, onMetrics);
    },
    [currentInstanceId]
  );

  const handlePlayPause = useCallback(() => {
    if (!video || !objectUrl) return;

    if (isCurrentVideo) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      play({
        id: video.id,
        name: video.name,
        objectUrl: objectUrl,
        mimeType: video.mimeType
      });
    }
  }, [video, objectUrl, isCurrentVideo, isPlaying, play, pause, resume]);

  const handleDownload = useCallback(async () => {
    if (!video) return;

    setActionLoading('download');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        video.storagePath,
        createRetrieveLogger(db)
      );
      downloadFile(data, video.name);
    } catch (err) {
      console.error('Failed to download video:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [video, retrieveFileData]);

  const handleShare = useCallback(async () => {
    if (!video) return;

    setActionLoading('share');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        video.storagePath,
        createRetrieveLogger(db)
      );
      const shared = await shareFile(data, video.name, video.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      // User cancelled share - don't show error
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share video:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [video, retrieveFileData]);

  const handleDelete = useCallback(async () => {
    if (!video) return;

    setActionLoading('delete');
    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, video.id));

      navigate('/videos');
    } catch (err) {
      console.error('Failed to delete video:', err);
      setError(err instanceof Error ? err.message : String(err));
      setActionLoading(null);
    }
  }, [video, navigate]);

  const handleUpdateName = useCallback(
    async (newName: string) => {
      if (!id) return;

      const db = getDatabase();
      await db.update(files).set({ name: newName }).where(eq(files.id, id));

      setVideo((prev) => (prev ? { ...prev, name: newName } : prev));
    },
    [id]
  );

  const fetchVideo = useCallback(async () => {
    if (!isUnlocked || !id) return;

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
        .where(
          and(
            eq(files.id, id),
            like(files.mimeType, 'video/%'),
            eq(files.deleted, false)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('Video file not found');
        return;
      }

      const videoInfo: VideoInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      };
      setVideo(videoInfo);

      // Load video data and create object URL
      const logger = createRetrieveLogger(db);
      const data = await retrieveFileData(videoInfo.storagePath, logger);
      // Copy to ArrayBuffer - required because Uint8Array<ArrayBufferLike> is not
      // assignable to BlobPart in strict TypeScript (SharedArrayBuffer incompatibility)
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: videoInfo.mimeType });
      const url = URL.createObjectURL(blob);
      urlsToRevoke.current.push(url);
      objectUrlRef.current = url;
      setObjectUrl(url);
    } catch (err) {
      console.error('Failed to fetch video:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id, retrieveFileData]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchVideo();
    }
  }, [isUnlocked, id, fetchVideo]);

  // Keep currentVideoRef in sync with currentVideo
  useEffect(() => {
    currentVideoRef.current = currentVideo;
  }, [currentVideo]);

  // Only revoke URLs on unmount, not on URL changes.
  // Skip revoking the current objectUrl if this video is still playing
  useEffect(() => {
    return () => {
      const currentlyPlayingUrl =
        currentVideoRef.current?.id === id ? objectUrlRef.current : null;
      for (const url of urlsToRevoke.current) {
        if (url !== currentlyPlayingUrl) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/videos" defaultLabel="Back to Videos" />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="this video file" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading video...
        </div>
      )}

      {isUnlocked && !loading && !error && video && (
        <div className="space-y-6">
          <EditableTitle
            value={video.name}
            onSave={handleUpdateName}
            data-testid="video-title"
          />

          {objectUrl && (
            <div className="flex flex-col items-center gap-4 overflow-hidden rounded-lg border bg-muted p-4">
              <video
                src={objectUrl}
                controls
                playsInline
                className="max-h-[60vh] w-full rounded-lg"
                data-testid="video-player"
              >
                <track kind="captions" />
              </video>
              <Button
                variant={isVideoPlaying ? 'default' : 'outline'}
                size="lg"
                onClick={handlePlayPause}
                aria-label={isVideoPlaying ? 'Pause' : 'Play'}
                data-testid="play-pause-button"
                className="gap-2"
              >
                {isVideoPlaying ? (
                  <>
                    <Pause className="h-5 w-5" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5" />
                    Play
                  </>
                )}
              </Button>
            </div>
          )}

          {!objectUrl && (
            <div className="flex flex-col items-center gap-4 overflow-hidden rounded-lg border bg-muted p-8">
              <Film className="h-24 w-24 text-muted-foreground" />
              <p className="text-muted-foreground">Loading video...</p>
            </div>
          )}

          <ActionToolbar
            onDownload={handleDownload}
            onShare={handleShare}
            onDelete={handleDelete}
            loadingAction={actionLoading}
            canShare={canShare}
          />

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Video Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileType className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Type</span>
                <span className="ml-auto font-mono text-sm">
                  {video.mimeType}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Size</span>
                <span className="ml-auto font-mono text-sm">
                  {formatFileSize(video.size)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Uploaded</span>
                <span className="ml-auto text-sm">
                  {formatDate(video.uploadDate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
