import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from '@tearleads/audio';
import { and, eq, like } from 'drizzle-orm';
import {
  Calendar,
  FileType,
  HardDrive,
  Loader2,
  Music,
  Pause,
  Play
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAudio } from '@/audio';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar, type ActionType } from '@/components/ui/action-toolbar';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { EditableTitle } from '@/components/ui/editable-title';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useAudioErrorHandler } from '@/hooks/useAudioErrorHandler';
import { type AudioMetadata, extractAudioMetadata } from '@/lib/audio-metadata';
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
  const { t } = useTranslation('audio');
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    searchParams.get('playlist') ?? ALL_AUDIO_ID
  );
  useAudioErrorHandler();
  const currentTrackRef = useRef(currentTrack);
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);

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

  const handleDelete = useCallback(async () => {
    if (!audio) return;

    setActionLoading('delete');
    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, audio.id));

      navigate('/audio');
    } catch (err) {
      console.error('Failed to delete audio:', err);
      setError(err instanceof Error ? err.message : String(err));
      setActionLoading(null);
    }
  }, [audio, navigate]);

  const handleUpdateName = useCallback(
    async (newName: string) => {
      if (!id) return;

      const db = getDatabase();
      await db.update(files).set({ name: newName }).where(eq(files.id, id));

      setAudio((prev) => (prev ? { ...prev, name: newName } : prev));
    },
    [id]
  );

  const fetchAudio = useCallback(async () => {
    if (!isUnlocked || !id) return;

    setLoading(true);
    setError(null);
    setMetadata(null);

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
      const metadataResult = await extractAudioMetadata(
        data,
        audioInfo.mimeType
      );
      setMetadata(metadataResult);
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

  const handlePlaylistSelect = useCallback(
    (playlistId: string | null) => {
      setSelectedPlaylistId(playlistId);
      const query =
        playlistId && playlistId !== ALL_AUDIO_ID
          ? `?playlist=${playlistId}`
          : '';
      navigate(`/audio${query}`);
    },
    [navigate]
  );

  const trackText =
    metadata?.trackNumber != null
      ? metadata.trackTotal
        ? `${metadata.trackNumber}/${metadata.trackTotal}`
        : `${metadata.trackNumber}`
      : null;
  const metadataRows = useMemo(
    () =>
      [
        { label: t('title'), value: metadata?.title ?? null },
        { label: t('artist'), value: metadata?.artist ?? null },
        { label: t('album'), value: metadata?.album ?? null },
        { label: t('albumArtist'), value: metadata?.albumArtist ?? null },
        {
          label: t('year'),
          value: metadata?.year != null ? `${metadata.year}` : null
        },
        { label: t('track'), value: trackText },
        {
          label: t('genre'),
          value: metadata?.genre?.length ? metadata.genre.join(', ') : null
        }
      ].filter((row) => row.value !== null),
    [t, metadata, trackText]
  );

  return (
    <div className="flex h-full gap-6">
      {isUnlocked && (
        <AudioPlaylistsSidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          selectedPlaylistId={selectedPlaylistId}
          onPlaylistSelect={handlePlaylistSelect}
        />
      )}
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center gap-4">
          <BackLink defaultTo="/audio" defaultLabel={t('back')} />
        </div>

        {isLoading && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            {t('loadingDatabase')}
          </div>
        )}

        {!isLoading && !isUnlocked && (
          <InlineUnlock description={t('thisAudioFile')} />
        )}

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
            {error}
          </div>
        )}

        {isUnlocked && loading && (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('loadingAudio')}
          </div>
        )}

        {isUnlocked && !loading && !error && audio && (
          <div className="space-y-6">
            <EditableTitle
              value={audio.name}
              onSave={handleUpdateName}
              data-testid="audio-title"
            />

            {objectUrl && (
              <div className="flex flex-col items-center gap-4 overflow-hidden rounded-lg border bg-muted p-8">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={t('albumCover')}
                    className="h-48 w-48 rounded-lg object-cover"
                  />
                ) : (
                  <Music className="h-24 w-24 text-muted-foreground" />
                )}
                <Button
                  variant={isTrackPlaying ? 'default' : 'outline'}
                  size="lg"
                  onClick={handlePlayPause}
                  aria-label={isTrackPlaying ? t('pause') : t('play')}
                  data-testid="play-pause-button"
                  className="gap-2"
                >
                  {isTrackPlaying ? (
                    <>
                      <Pause className="h-5 w-5" />
                      {t('pause')}
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5" />
                      {t('play')}
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
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">{t('audioDetails')}</h2>
              </div>
              <div className="divide-y">
                <div className="flex items-center gap-3 px-4 py-3">
                  <FileType className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">
                    {t('type')}
                  </span>
                  <span className="ml-auto font-mono text-sm">
                    {audio.mimeType}
                  </span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">
                    {t('size')}
                  </span>
                  <span className="ml-auto font-mono text-sm">
                    {formatFileSize(audio.size)}
                  </span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">
                    {t('uploaded')}
                  </span>
                  <span className="ml-auto text-sm">
                    {formatDate(audio.uploadDate)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">{t('metadata')}</h2>
              </div>
              <div className="divide-y">
                {metadataRows.length === 0 ? (
                  <div className="px-4 py-3 text-muted-foreground text-sm">
                    {t('noMetadataFound')}
                  </div>
                ) : (
                  metadataRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="text-muted-foreground text-sm">
                        {row.label}
                      </span>
                      <span className="ml-auto text-sm">{row.value}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
