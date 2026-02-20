import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, Music, Pause } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../../context/AudioContext';
import {
  type AudioWithUrl,
  useAudioUIContext
} from '../../context/AudioUIContext';
import { setMediaDragData } from '../../lib/mediaDragData';
import { AudioListContextMenus } from './AudioListContextMenus';
import { AudioListHeader } from './AudioListHeader';
import {
  type AudioWindowListProps,
  type BlankSpaceMenuState,
  type ContextMenuState,
  useAudioTableData
} from './audio-table';

const ROW_HEIGHT_ESTIMATE = 56;

export function AudioWindowList({
  onSelectTrack,
  refreshToken = 0,
  showDeleted = false,
  showDropzone = false,
  onUploadFiles,
  selectedPlaylistId,
  selectedAlbumId: _selectedAlbumId,
  onAlbumSelect: _onAlbumSelect,
  uploading = false,
  uploadProgress = 0,
  onUpload
}: AudioWindowListProps) {
  // TODO: Album filtering requires extracting metadata from track binary data.
  // For now, selectedAlbumId is accepted but filtering is not implemented.
  // See issue #1800 for implementation notes.
  const {
    databaseState,
    ui,
    t,
    softDeleteAudio,
    restoreAudio,
    formatFileSize,
    logError,
    detectPlatform
  } = useAudioUIContext();
  const { isUnlocked, isLoading } = databaseState;
  const {
    ListRow,
    RefreshButton,
    InlineUnlock,
    Input,
    VirtualListStatus,
    Dropzone,
    AudioPlayer
  } = ui;

  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [blankSpaceMenu, setBlankSpaceMenu] =
    useState<BlankSpaceMenuState | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    tracks,
    setTracks,
    loading,
    error,
    setError,
    hasFetched,
    fetchTracks,
    currentTrackRef
  } = useAudioTableData({ selectedPlaylistId, showDeleted, refreshToken });

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack, currentTrackRef]);

  const filteredTracks = tracks.filter((track) => {
    const searchLower = searchQuery.toLowerCase();
    return track.name.toLowerCase().includes(searchLower);
  });

  const virtualizer = useVirtualizer({
    count: filteredTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? 0) : 0;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? 0)
      : 0;

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, [detectPlatform]);

  const handlePlayPause = useCallback(
    (track: AudioWithUrl) => {
      if (currentTrack?.id === track.id) {
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
    },
    [currentTrack?.id, isPlaying, pause, resume, play]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, track: AudioWithUrl) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ track, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleBlankSpaceContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
    },
    [onUpload]
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuInfo = useCallback(() => {
    if (!contextMenu) return;
    onSelectTrack?.(contextMenu.track.id);
    setContextMenu(null);
  }, [contextMenu, onSelectTrack]);

  const handleContextMenuPlay = useCallback(
    (track: AudioWithUrl) => {
      handlePlayPause(track);
      setContextMenu(null);
    },
    [handlePlayPause]
  );

  const handleDelete = useCallback(
    async (trackToDelete: AudioWithUrl) => {
      setContextMenu(null);

      try {
        await softDeleteAudio(trackToDelete.id);

        setTracks((prev) => {
          const remaining = prev.filter((t) => t.id !== trackToDelete.id);
          URL.revokeObjectURL(trackToDelete.objectUrl);
          if (trackToDelete.thumbnailUrl) {
            URL.revokeObjectURL(trackToDelete.thumbnailUrl);
          }
          return remaining;
        });
      } catch (err) {
        logError('Failed to delete track', String(err));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [softDeleteAudio, logError, setTracks, setError]
  );

  const handleRestore = useCallback(
    async (trackToRestore: AudioWithUrl) => {
      setContextMenu(null);

      try {
        await restoreAudio(trackToRestore.id);
        setTracks((prev) =>
          prev.map((track) =>
            track.id === trackToRestore.id
              ? { ...track, deleted: false }
              : track
          )
        );
      } catch (err) {
        logError('Failed to restore track', String(err));
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [logError, restoreAudio, setTracks, setError]
  );

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <AudioListHeader isUnlocked={isUnlocked}>
        <RefreshButton onClick={fetchTracks} loading={loading} size="sm" />
      </AudioListHeader>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          {t('loadingDatabase')}
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="audio" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (uploading ? (
          (() => {
            const clampedProgress = Math.max(
              0,
              Math.min(100, Math.round(uploadProgress))
            );
            return (
              <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-medium">{t('uploading')}</p>
                </div>
                <div className="w-full max-w-sm">
                  <div className="mb-2 flex items-center justify-between text-muted-foreground text-xs">
                    <span>{t('uploadProgress')}</span>
                    <span>{clampedProgress}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={t('uploadProgress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={clampedProgress}
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${clampedProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()
        ) : loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loadingAudio')}
          </div>
        ) : tracks.length === 0 && hasFetched ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
          <div
            className="rounded-lg border p-6 text-center"
            onContextMenu={handleBlankSpaceContextMenu}
          >
            {showDropzone && onUploadFiles ? (
              <div className="space-y-3">
                <Dropzone
                  onFilesSelected={onUploadFiles}
                  accept="audio/*"
                  multiple={false}
                  label={t('audioFiles')}
                  source="media"
                />
                {isDesktopPlatform && (
                  <p className="text-muted-foreground text-xs">
                    Drop an audio file here to add it to your library
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Music className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{t('noAudioFiles')}</p>
                  <p className="text-muted-foreground text-xs">
                    Use Upload to add audio
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            <AudioPlayer tracks={tracks} />
            <Input
              type="search"
              placeholder={t('searchTracks')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-base"
              data-testid="window-audio-search"
            />
            <VirtualListStatus
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              loadedCount={filteredTracks.length}
              itemLabel="track"
            />
            <div className="flex-1 rounded-lg border">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
              <div
                ref={parentRef}
                className="h-full overflow-auto"
                onContextMenu={handleBlankSpaceContextMenu}
              >
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((virtualItem) => {
                    const track = filteredTracks[virtualItem.index];
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
                          data-testid={`window-audio-track-${track.id}`}
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
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
                            data-testid={`window-audio-play-${track.id}`}
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
                                  className="h-7 w-7 rounded object-cover"
                                />
                              ) : (
                                <Music className="h-4 w-4 text-muted-foreground" />
                              )}
                              {isTrackPlaying && (
                                <div className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <Pause className="h-2 w-2" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-xs">
                                {track.name}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {formatFileSize(track.size)}
                              </p>
                            </div>
                          </button>
                        </ListRow>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {showDropzone && onUploadFiles && (
              <Dropzone
                onFilesSelected={onUploadFiles}
                accept="audio/*"
                multiple={false}
                label={t('audioFiles')}
                source="media"
                compact
                variant="row"
              />
            )}
          </div>
        ))}

      <AudioListContextMenus
        contextMenu={contextMenu}
        blankSpaceMenu={blankSpaceMenu}
        currentTrackId={currentTrack?.id}
        isPlaying={isPlaying}
        onCloseContextMenu={handleCloseContextMenu}
        onCloseBlankSpaceMenu={() => setBlankSpaceMenu(null)}
        onContextMenuPlay={handleContextMenuPlay}
        onContextMenuInfo={handleContextMenuInfo}
        onDelete={handleDelete}
        onRestore={handleRestore}
        onUpload={onUpload}
        labels={{
          restore: t('restore'),
          play: t('play'),
          pause: t('pause'),
          getInfo: t('getInfo'),
          delete: t('delete')
        }}
      />
    </div>
  );
}
