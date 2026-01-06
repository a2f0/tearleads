import { and, desc, eq, like } from 'drizzle-orm';
import { Loader2, Music, Pause, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'audio/aiff',
  'audio/x-aiff'
];

interface AudioInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

interface AudioWithUrl extends AudioInfo {
  objectUrl: string;
  thumbnailUrl: string | null;
}

export function AudioPage() {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const currentTrackRef = useRef(currentTrack);
  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();

  const fetchTracks = useCallback(async () => {
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
        .where(and(like(files.mimeType, 'audio/%'), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate));

      const trackList: AudioInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      // Load audio data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      const tracksWithUrls = (
        await Promise.all(
          trackList.map(async (track) => {
            try {
              const data = await storage.measureRetrieve(
                track.storagePath,
                logger
              );
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: track.mimeType });
              const objectUrl = URL.createObjectURL(blob);

              let thumbnailUrl: string | null = null;
              if (track.thumbnailPath) {
                try {
                  const thumbData = await storage.measureRetrieve(
                    track.thumbnailPath,
                    logger
                  );
                  const thumbBuffer = new ArrayBuffer(thumbData.byteLength);
                  new Uint8Array(thumbBuffer).set(thumbData);
                  const thumbBlob = new Blob([thumbBuffer], {
                    type: 'image/jpeg'
                  });
                  thumbnailUrl = URL.createObjectURL(thumbBlob);
                } catch (err) {
                  console.warn(
                    `Failed to load thumbnail for ${track.name}:`,
                    err
                  );
                }
              }

              return { ...track, objectUrl, thumbnailUrl };
            } catch (err) {
              console.error(`Failed to load track ${track.name}:`, err);
              return null;
            }
          })
        )
      ).filter((t): t is AudioWithUrl => t !== null);

      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId]);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        for (const file of files) {
          // Validate that the file type is one of the supported audio MIME types
          if (!AUDIO_MIME_TYPES.includes(file.type)) {
            throw new Error(
              `"${file.name}" has an unsupported audio format. Supported formats: MP3, WAV, OGG, FLAC, AAC, M4A, WebM, AIFF.`
            );
          }

          await uploadFile(file, setUploadProgress);
        }

        // Refresh tracks after successful upload
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

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchTracks();
    }
  }, [isUnlocked, hasFetched, loading, fetchTracks]);

  // Keep currentTrackRef in sync with currentTrack
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Cleanup object URLs on unmount, except for the currently playing track
  // (AudioContext is responsible for the playing track's lifecycle)
  useEffect(() => {
    return () => {
      for (const t of tracks) {
        if (t.id !== currentTrackRef.current?.id) {
          URL.revokeObjectURL(t.objectUrl);
        }
        if (t.thumbnailUrl) {
          URL.revokeObjectURL(t.thumbnailUrl);
        }
      }
    };
  }, [tracks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Music className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Audio</h1>
        </div>
        {isUnlocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTracks}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="audio" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading audio...
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
        ) : tracks.length === 0 && hasFetched ? (
          <div className="space-y-4">
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="audio/*"
              multiple={false}
              disabled={uploading}
            />
            <p className="text-center text-muted-foreground text-sm">
              Drop an audio file here to add it to your library
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tracks.map((track) => {
              const isCurrentTrack = currentTrack?.id === track.id;
              const isTrackPlaying = isCurrentTrack && isPlaying;

              const handlePlayPause = () => {
                if (isCurrentTrack) {
                  if (isPlaying) {
                    pause();
                  } else {
                    resume();
                  }
                } else {
                  play({
                    id: track.id,
                    name: track.name,
                    objectUrl: track.objectUrl,
                    mimeType: track.mimeType
                  });
                }
              };

              return (
                <div
                  key={track.id}
                  className={`flex items-center gap-4 rounded-lg border p-4 ${
                    isCurrentTrack ? 'border-primary bg-primary/5' : ''
                  }`}
                  data-testid={`audio-track-${track.id}`}
                >
                  <Link
                    to={`/audio/${track.id}`}
                    className="group flex min-w-0 flex-1 items-center gap-4"
                  >
                    {track.thumbnailUrl ? (
                      <img
                        src={track.thumbnailUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <Music className="h-8 w-8 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium group-hover:underline">
                        {track.name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {formatFileSize(track.size)}
                      </p>
                    </div>
                  </Link>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePlayPause}
                    aria-label={isTrackPlaying ? 'Pause' : 'Play'}
                    data-testid={`audio-play-${track.id}`}
                  >
                    {isTrackPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
