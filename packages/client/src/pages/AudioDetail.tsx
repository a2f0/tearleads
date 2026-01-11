import { and, eq, like } from 'drizzle-orm';
import {
  Calendar,
  Download,
  FileType,
  HardDrive,
  Loader2,
  Music,
  Pause,
  Play,
  Share2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useAudioErrorHandler } from '@/hooks/useAudioErrorHandler';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized,
  type RetrieveMetrics
} from '@/storage/opfs';

interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

export function AudioDetail() {
  const { id } = useParams<{ id: string }>();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  useAudioErrorHandler();
  const currentTrackRef = useRef(currentTrack);
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | null
  >(null);

  // Track all created blob URLs to revoke on unmount.
  // We don't revoke on URL changes because the browser/audio player may still be
  // loading the content asynchronously, causing playback issues.
  const urlsToRevoke = useRef<string[]>([]);
  const objectUrlRef = useRef<string | null>(null);

  const isCurrentTrack = currentTrack?.id === id;
  const isTrackPlaying = isCurrentTrack && isPlaying;

  // Check if Web Share API is available on mount
  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

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
    if (!audio || !objectUrl) return;

    if (isCurrentTrack) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      play({
        id: audio.id,
        name: audio.name,
        objectUrl: objectUrl,
        mimeType: audio.mimeType
      });
    }
  }, [audio, objectUrl, isCurrentTrack, isPlaying, play, pause, resume]);

  const handleDownload = useCallback(async () => {
    if (!audio) return;

    setActionLoading('download');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        audio.storagePath,
        createRetrieveLogger(db)
      );
      downloadFile(data, audio.name);
    } catch (err) {
      console.error('Failed to download audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFileData]);

  const handleShare = useCallback(async () => {
    if (!audio) return;

    setActionLoading('share');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        audio.storagePath,
        createRetrieveLogger(db)
      );
      const shared = await shareFile(data, audio.name, audio.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      // User cancelled share - don't show error
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFileData]);

  const fetchAudio = useCallback(async () => {
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
            like(files.mimeType, 'audio/%'),
            eq(files.deleted, false)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('Audio file not found');
        return;
      }

      const audioInfo: AudioInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      };
      setAudio(audioInfo);

      // Load audio data and create object URL
      const logger = createRetrieveLogger(db);
      const data = await retrieveFileData(audioInfo.storagePath, logger);
      // Copy to ArrayBuffer - required because Uint8Array<ArrayBufferLike> is not
      // assignable to BlobPart in strict TypeScript (SharedArrayBuffer incompatibility)
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: audioInfo.mimeType });
      const url = URL.createObjectURL(blob);
      urlsToRevoke.current.push(url);
      objectUrlRef.current = url;
      setObjectUrl(url);

      // Load thumbnail if available
      if (audioInfo.thumbnailPath) {
        try {
          const thumbData = await retrieveFileData(
            audioInfo.thumbnailPath,
            logger
          );
          const thumbBuffer = new ArrayBuffer(thumbData.byteLength);
          new Uint8Array(thumbBuffer).set(thumbData);
          const thumbBlob = new Blob([thumbBuffer], { type: 'image/jpeg' });
          const thumbUrl = URL.createObjectURL(thumbBlob);
          urlsToRevoke.current.push(thumbUrl);
          setThumbnailUrl(thumbUrl);
        } catch (err) {
          console.warn('Failed to load thumbnail:', err);
        }
      }
    } catch (err) {
      console.error('Failed to fetch audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id, retrieveFileData]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchAudio();
    }
  }, [isUnlocked, id, fetchAudio]);

  // Keep currentTrackRef in sync with currentTrack
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Only revoke URLs on unmount, not on URL changes.
  // Skip revoking the current objectUrl if this track is still playing
  // (AudioContext manages the playing track's lifecycle).
  useEffect(() => {
    return () => {
      const currentlyPlayingUrl =
        currentTrackRef.current?.id === id ? objectUrlRef.current : null;
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
        <BackLink defaultTo="/audio" defaultLabel="Back to Audio" />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="this audio file" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading audio...
        </div>
      )}

      {isUnlocked && !loading && !error && audio && (
        <div className="space-y-6">
          <h1 className="font-bold text-2xl tracking-tight">{audio.name}</h1>

          {objectUrl && (
            <div className="flex flex-col items-center gap-4 overflow-hidden rounded-lg border bg-muted p-8">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt="Album cover"
                  className="h-48 w-48 rounded-lg object-cover"
                />
              ) : (
                <Music className="h-24 w-24 text-muted-foreground" />
              )}
              <Button
                variant={isTrackPlaying ? 'default' : 'outline'}
                size="lg"
                onClick={handlePlayPause}
                aria-label={isTrackPlaying ? 'Pause' : 'Play'}
                data-testid="play-pause-button"
                className="gap-2"
              >
                {isTrackPlaying ? (
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

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDownload}
              disabled={actionLoading !== null}
              data-testid="download-button"
            >
              {actionLoading === 'download' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download
            </Button>
            {canShare && (
              <Button
                variant="outline"
                onClick={handleShare}
                disabled={actionLoading !== null}
                data-testid="share-button"
              >
                {actionLoading === 'share' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-2 h-4 w-4" />
                )}
                Share
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Audio Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileType className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Type</span>
                <span className="ml-auto font-mono text-sm">
                  {audio.mimeType}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Size</span>
                <span className="ml-auto font-mono text-sm">
                  {formatFileSize(audio.size)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Uploaded</span>
                <span className="ml-auto text-sm">
                  {formatDate(audio.uploadDate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
