import { useVirtualizer } from '@tanstack/react-virtual';
import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from '@tearleads/audio';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import {
  ChevronRight,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  Trash2
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAudio } from '@/audio';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/ListRow';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { ClientAudioProvider } from '@/contexts/ClientAudioProvider';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { useVirtualVisibleRange } from '@/hooks/device';
import { useAudioErrorHandler } from '@/hooks/media';
import { useTypedTranslation } from '@/i18n';
import { linkAudioToPlaylist } from '@/lib/linkAudioToPlaylist';
import { setMediaDragData } from '@/lib/mediaDragData';
import { detectPlatform, formatFileSize } from '@/lib/utils';
import type { AudioPageProps, AudioWithUrl } from './audio-components/types';
import { ROW_HEIGHT_ESTIMATE } from './audio-components/types';
import { useAudioActions } from './audio-components/useAudioActions';
import { useAudioData } from './audio-components/useAudioData';
import { useAudioUpload } from './audio-components/useAudioUpload';

export function AudioPage({
  playlistId = null,
  hideBackLink = false
}: AudioPageProps = {}) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { currentTrack, isPlaying } = useAudio();
  const { t } = useTypedTranslation('contextMenu');
  useAudioErrorHandler();
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    tracks,
    setTracks,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchTracks
  } = useAudioData(playlistId);

  const { uploading, uploadProgress, handleFilesSelected } = useAudioUpload(
    setError,
    setHasFetched
  );

  const {
    contextMenu,
    handlePlayPause,
    handleNavigateToDetail,
    handleContextMenu,
    handleCloseContextMenu,
    handleGetInfo,
    handleContextMenuPlay,
    handleDelete
  } = useAudioActions(setTracks, setError);

  const virtualizer = useVirtualizer({
    count: tracks.length,
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

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {!hideBackLink && (
          <BackLink defaultTo="/" defaultLabel="Back to Home" />
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Music className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Audio</h1>
          </div>
          {isUnlocked && (
            <RefreshButton onClick={fetchTracks} loading={loading} />
          )}
        </div>
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
            </div>
            <UploadProgress progress={uploadProgress} />
          </div>
        ) : tracks.length === 0 && hasFetched ? (
          <div className="space-y-4">
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="audio/*"
              multiple={false}
              disabled={uploading}
            />
            {isDesktopPlatform && (
              <p className="text-center text-muted-foreground text-sm">
                Drop an audio file here to add it to your library
              </p>
            )}
          </div>
        ) : (
          <AudioTrackList
            tracks={tracks}
            virtualizer={virtualizer}
            virtualItems={virtualItems}
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            parentRef={parentRef}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            isDesktopPlatform={isDesktopPlatform}
            uploading={uploading}
            handleFilesSelected={handleFilesSelected}
            handlePlayPause={handlePlayPause}
            handleNavigateToDetail={handleNavigateToDetail}
            handleContextMenu={handleContextMenu}
          />
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={
              contextMenu.track.id === currentTrack?.id && isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )
            }
            onClick={() => handleContextMenuPlay(contextMenu.track)}
          >
            {contextMenu.track.id === currentTrack?.id && isPlaying
              ? t('pause')
              : t('play')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => handleGetInfo(contextMenu.track)}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => handleDelete(contextMenu.track)}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

interface AudioTrackListProps {
  tracks: AudioWithUrl[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  virtualItems: ReturnType<
    ReturnType<
      typeof useVirtualizer<HTMLDivElement, Element>
    >['getVirtualItems']
  >;
  firstVisible: number | null;
  lastVisible: number | null;
  parentRef: React.RefObject<HTMLDivElement | null>;
  currentTrack: { id: string } | null;
  isPlaying: boolean;
  isDesktopPlatform: boolean;
  uploading: boolean;
  handleFilesSelected: (files: File[]) => void;
  handlePlayPause: (track: AudioWithUrl) => void;
  handleNavigateToDetail: (trackId: string) => void;
  handleContextMenu: (e: React.MouseEvent, track: AudioWithUrl) => void;
}

function AudioTrackList({
  tracks,
  virtualizer,
  virtualItems,
  firstVisible,
  lastVisible,
  parentRef,
  currentTrack,
  isPlaying,
  isDesktopPlatform,
  uploading,
  handleFilesSelected,
  handlePlayPause,
  handleNavigateToDetail,
  handleContextMenu
}: AudioTrackListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      <AudioPlayer tracks={tracks} />
      <VirtualListStatus
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        loadedCount={tracks.length}
        itemLabel="track"
      />
      <div className="flex-1 rounded-lg border">
        <div ref={parentRef} className="h-full overflow-auto">
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const track = tracks[virtualItem.index];
              if (!track) return null;

              const isCurrentTrack = currentTrack?.id === track.id;
              const isTrackPlaying = isCurrentTrack && isPlaying;

              return (
                <div
                  key={track.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-1 py-0.5"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  <ListRow
                    className={`${
                      isCurrentTrack ? 'border-primary bg-primary/5' : ''
                    }`}
                    data-testid={`audio-track-${track.id}`}
                    onContextMenu={(e) => handleContextMenu(e, track)}
                  >
                    <button
                      type="button"
                      onClick={
                        isDesktopPlatform
                          ? undefined
                          : () => handlePlayPause(track)
                      }
                      onDoubleClick={
                        isDesktopPlatform
                          ? () => handlePlayPause(track)
                          : undefined
                      }
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                      data-testid={`audio-play-${track.id}`}
                      draggable
                      onDragStart={(event) =>
                        setMediaDragData(event, 'audio', [track.id])
                      }
                    >
                      <div className="relative shrink-0">
                        {track.thumbnailUrl ? (
                          <img
                            src={track.thumbnailUrl}
                            alt=""
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : (
                          <Music className="h-5 w-5 text-muted-foreground" />
                        )}
                        {isTrackPlaying && (
                          <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Pause className="h-2.5 w-2.5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">
                          {track.name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatFileSize(track.size)}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleNavigateToDetail(track.id)}
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
      <Dropzone
        onFilesSelected={handleFilesSelected}
        accept="audio/*"
        multiple={false}
        disabled={uploading}
        label="audio files"
        source="media"
        compact
        variant="row"
      />
    </div>
  );
}

function AudioWithSidebar() {
  const { playlistId } = useParams<{ playlistId?: string }>();
  const navigate = useNavigate();
  const { isUnlocked } = useDatabaseContext();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [refreshToken, setRefreshToken] = useState(0);

  // Derive selected playlist from URL (or ALL_AUDIO_ID if no param)
  const selectedPlaylistId = playlistId ?? ALL_AUDIO_ID;

  // Navigate on playlist selection
  const handlePlaylistSelect = useCallback(
    (id: string | null) => {
      if (id === ALL_AUDIO_ID || id === null) {
        navigate('/audio');
      } else {
        navigate(`/audio/playlists/${id}`);
      }
    },
    [navigate]
  );

  const handleDropToPlaylist = useCallback(
    async (playlistId: string, files: File[], audioIds?: string[]) => {
      void files;
      if (!audioIds || audioIds.length === 0) return;
      const db = getDatabase();
      const insertedCount = await linkAudioToPlaylist(db, playlistId, audioIds);
      if (insertedCount > 0) {
        setRefreshToken((value) => value + 1);
      }
    },
    []
  );

  return (
    <div className="flex h-full flex-col space-y-4">
      <BackLink defaultTo="/" defaultLabel="Back to Home" />
      <div className="flex min-h-0 flex-1">
        {isUnlocked && (
          <div className="hidden md:block">
            <AudioPlaylistsSidebar
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
          <AudioPage
            hideBackLink
            playlistId={
              selectedPlaylistId === ALL_AUDIO_ID ? null : selectedPlaylistId
            }
          />
        </div>
      </div>
    </div>
  );
}

export function Audio() {
  return (
    <ClientAudioProvider>
      <AudioWithSidebar />
    </ClientAudioProvider>
  );
}
