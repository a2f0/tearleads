import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from '@tearleads/audio';
import {
  Calendar,
  FileType,
  HardDrive,
  Loader2,
  Music,
  Pause,
  Play
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar } from '@/components/ui/ActionToolbar';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { EditableTitle } from '@/components/ui/editable-title';
import { useAudioErrorHandler } from '@/hooks/useAudioErrorHandler';
import { formatDate, formatFileSize } from '@/lib/utils';
import { useAudioDetailActions, useAudioDetailData } from './audioDetailState';

export function AudioDetail() {
  const { t } = useTranslation('audio');
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    searchParams.get('playlist') ?? ALL_AUDIO_ID
  );
  useAudioErrorHandler();

  const {
    audio,
    objectUrl,
    thumbnailUrl,
    metadata,
    loading,
    error,
    isUnlocked,
    isLoading,
    setError,
    retrieveFileData,
    setCurrentTrack,
    updateAudioName
  } = useAudioDetailData({ id });

  const {
    currentTrack,
    isTrackPlaying,
    actionLoading,
    canShare,
    handlePlayPause,
    handleDownload,
    handleShare,
    handleDelete,
    handleUpdateName
  } = useAudioDetailActions({
    audio,
    objectUrl,
    retrieveFileData,
    setError,
    updateAudioName
  });

  // Keep currentTrack ref in sync
  useEffect(() => {
    setCurrentTrack(currentTrack);
  }, [currentTrack, setCurrentTrack]);

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
