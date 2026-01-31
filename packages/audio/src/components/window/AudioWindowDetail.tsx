import {
  ArrowLeft,
  Calendar,
  FileType,
  HardDrive,
  Loader2,
  Music,
  Pause,
  Play
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '../../context/AudioContext';
import {
  type AudioInfo,
  type AudioMetadata,
  useAudioUIContext
} from '../../context/AudioUIContext';

interface AudioWindowDetailProps {
  audioId: string;
  onBack: () => void;
  onDeleted: () => void;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.buffer instanceof ArrayBuffer) {
    return data.byteLength === data.buffer.byteLength
      ? data.buffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

function createBlobUrl(data: Uint8Array, mimeType: string): string {
  const buffer = toArrayBuffer(data);
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function AudioWindowDetail({
  audioId,
  onBack,
  onDeleted
}: AudioWindowDetailProps) {
  const {
    databaseState,
    ui,
    fetchAudioFiles,
    retrieveFile,
    softDeleteAudio,
    updateAudioName,
    formatFileSize,
    formatDate,
    extractAudioMetadata,
    downloadFile,
    shareFile,
    canShareFiles
  } = useAudioUIContext();
  const { isUnlocked, isLoading } = databaseState;
  const { Button, InlineUnlock, EditableTitle, ActionToolbar } = ui;

  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const currentTrackRef = useRef(currentTrack);
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | 'delete' | null
  >(null);

  const urlsToRevoke = useRef<string[]>([]);
  const objectUrlRef = useRef<string | null>(null);

  const isCurrentTrack = currentTrack?.id === audioId;
  const isTrackPlaying = isCurrentTrack && isPlaying;

  useEffect(() => {
    setCanShare(canShareFiles());
  }, [canShareFiles]);

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
  }, [audio, objectUrl, isCurrentTrack, isPlaying, pause, play, resume]);

  const handleDownload = useCallback(async () => {
    if (!audio) return;

    setActionLoading('download');
    try {
      const data = await retrieveFile(audio.storagePath);
      const uint8Data =
        data instanceof Uint8Array ? data : new Uint8Array(data);
      downloadFile(uint8Data, audio.name);
    } catch (err) {
      console.error('Failed to download audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFile, downloadFile]);

  const handleShare = useCallback(async () => {
    if (!audio) return;

    setActionLoading('share');
    try {
      const data = await retrieveFile(audio.storagePath);
      const uint8Data =
        data instanceof Uint8Array ? data : new Uint8Array(data);
      const shared = await shareFile(uint8Data, audio.name, audio.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFile, shareFile]);

  const handleDelete = useCallback(async () => {
    if (!audio) return;

    setActionLoading('delete');
    try {
      await softDeleteAudio(audio.id);
      onDeleted();
    } catch (err) {
      console.error('Failed to delete audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, softDeleteAudio, onDeleted]);

  const handleUpdateName = useCallback(
    async (newName: string) => {
      await updateAudioName(audioId, newName);
      setAudio((prev) => (prev ? { ...prev, name: newName } : prev));
    },
    [audioId, updateAudioName]
  );

  const fetchAudio = useCallback(async () => {
    if (!isUnlocked || !audioId) return;

    setLoading(true);
    setError(null);
    setMetadata(null);

    try {
      const audioFiles = await fetchAudioFiles();
      const audioInfo = audioFiles.find((f) => f.id === audioId);

      if (!audioInfo) {
        setError('Audio file not found');
        return;
      }

      setAudio(audioInfo);

      const data = await retrieveFile(audioInfo.storagePath);
      const uint8Data =
        data instanceof Uint8Array ? data : new Uint8Array(data);
      const metadataResult = await extractAudioMetadata(
        uint8Data,
        audioInfo.mimeType
      );
      setMetadata(metadataResult);

      const url = createBlobUrl(uint8Data, audioInfo.mimeType);
      urlsToRevoke.current.push(url);
      objectUrlRef.current = url;
      setObjectUrl(url);

      if (audioInfo.thumbnailPath) {
        try {
          const thumbData = await retrieveFile(audioInfo.thumbnailPath);
          const uint8ThumbData =
            thumbData instanceof Uint8Array
              ? thumbData
              : new Uint8Array(thumbData);
          const thumbUrl = createBlobUrl(uint8ThumbData, 'image/jpeg');
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
  }, [
    audioId,
    isUnlocked,
    fetchAudioFiles,
    retrieveFile,
    extractAudioMetadata
  ]);

  useEffect(() => {
    if (isUnlocked && audioId) {
      fetchAudio();
    }
  }, [audioId, fetchAudio, isUnlocked]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    return () => {
      const currentlyPlayingUrl =
        currentTrackRef.current?.id === audioId ? objectUrlRef.current : null;
      for (const url of urlsToRevoke.current) {
        if (url !== currentlyPlayingUrl) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [audioId]);

  const trackText =
    metadata?.trackNumber != null
      ? metadata.trackTotal
        ? `${metadata.trackNumber}/${metadata.trackTotal}`
        : `${metadata.trackNumber}`
      : null;
  const metadataRows = [
    { label: 'Title', value: metadata?.title ?? null },
    { label: 'Artist', value: metadata?.artist ?? null },
    { label: 'Album', value: metadata?.album ?? null },
    { label: 'Album Artist', value: metadata?.albumArtist ?? null },
    {
      label: 'Year',
      value: metadata?.year != null ? `${metadata.year}` : null
    },
    { label: 'Track', value: trackText },
    {
      label: 'Genre',
      value: metadata?.genre?.length ? metadata.genre.join(', ') : null
    }
  ].filter((row) => row.value !== null);

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="this audio file" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading audio...
        </div>
      )}

      {isUnlocked && !loading && !error && audio && (
        <div className="space-y-3">
          <EditableTitle
            value={audio.name}
            onSave={handleUpdateName}
            data-testid="audio-title"
          />

          {objectUrl && (
            <div className="flex flex-col items-center gap-3 overflow-hidden rounded-lg border bg-muted p-4">
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt="Album cover"
                  className="h-32 w-32 rounded-lg object-cover"
                />
              ) : (
                <Music className="h-16 w-16 text-muted-foreground" />
              )}
              <Button
                variant={isTrackPlaying ? 'default' : 'outline'}
                size="sm"
                onClick={handlePlayPause}
                aria-label={isTrackPlaying ? 'Pause' : 'Play'}
                data-testid="play-pause-button"
                className="gap-2"
              >
                {isTrackPlaying ? (
                  <>
                    <Pause className="h-4 w-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Play
                  </>
                )}
              </Button>
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
            <div className="border-b px-3 py-2">
              <h2 className="font-semibold text-sm">Audio Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-3 py-2">
                <FileType className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">Type</span>
                <span className="ml-auto font-mono text-xs">
                  {audio.mimeType}
                </span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">Size</span>
                <span className="ml-auto font-mono text-xs">
                  {formatFileSize(audio.size)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-3 py-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">Uploaded</span>
                <span className="ml-auto text-xs">
                  {formatDate(audio.uploadDate)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border">
            <div className="border-b px-3 py-2">
              <h2 className="font-semibold text-sm">Metadata</h2>
            </div>
            <div className="divide-y">
              {metadataRows.length === 0 ? (
                <div className="px-3 py-2 text-muted-foreground text-xs">
                  No embedded metadata found.
                </div>
              ) : (
                metadataRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <span className="text-muted-foreground text-xs">
                      {row.label}
                    </span>
                    <span className="ml-auto text-xs">{row.value}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
