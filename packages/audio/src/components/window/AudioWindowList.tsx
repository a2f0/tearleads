import { useVirtualizer } from '@tanstack/react-virtual';
import { Info, Loader2, Music, Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../../context/AudioContext';
import {
  type AudioWithUrl,
  useAudioUIContext
} from '../../context/AudioUIContext';
import { ALL_AUDIO_ID } from './AudioPlaylistsSidebar';

const ROW_HEIGHT_ESTIMATE = 56;

interface AudioWindowListProps {
  onSelectTrack?: (trackId: string) => void;
  refreshToken?: number;
  showDropzone?: boolean;
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  selectedPlaylistId?: string | null;
}

export function AudioWindowList({
  onSelectTrack,
  refreshToken = 0,
  showDropzone = false,
  onUploadFiles,
  selectedPlaylistId
}: AudioWindowListProps) {
  const {
    databaseState,
    ui,
    t,
    fetchAudioFilesWithUrls,
    getTrackIdsInPlaylist,
    softDeleteAudio,
    formatFileSize,
    logError,
    detectPlatform
  } = useAudioUIContext();
  const { isUnlocked, isLoading, currentInstanceId } = databaseState;
  const {
    ListRow,
    RefreshButton,
    InlineUnlock,
    ContextMenu,
    ContextMenuItem,
    Input,
    VirtualListStatus,
    Dropzone,
    AudioPlayer
  } = ui;

  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const currentTrackRef = useRef(currentTrack);
  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    track: AudioWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

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

  const fetchTracks = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      let trackIds: string[] | null = null;
      if (selectedPlaylistId && selectedPlaylistId !== ALL_AUDIO_ID) {
        trackIds = await getTrackIdsInPlaylist(selectedPlaylistId);
        if (trackIds.length === 0) {
          setTracks([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      const tracksWithUrls = await fetchAudioFilesWithUrls(
        trackIds ?? undefined
      );
      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      logError('Failed to fetch tracks', String(err));
      setError(err instanceof Error ? err.message : String(err));
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [
    fetchAudioFilesWithUrls,
    getTrackIdsInPlaylist,
    isUnlocked,
    logError,
    selectedPlaylistId
  ]);

  const fetchedForFilterRef = useRef<string | null>(null);

  useEffect(() => {
    const filterKey = selectedPlaylistId ?? ALL_AUDIO_ID;
    const fetchKey = `${currentInstanceId ?? 'none'}:${filterKey}`;

    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForFilterRef.current !== fetchKey);

    if (needsFetch) {
      if (
        fetchedForFilterRef.current !== fetchKey &&
        fetchedForFilterRef.current !== null
      ) {
        for (const track of tracks) {
          if (track.id !== currentTrackRef.current?.id) {
            URL.revokeObjectURL(track.objectUrl);
          }
          if (track.thumbnailUrl) {
            URL.revokeObjectURL(track.thumbnailUrl);
          }
        }
        setTracks([]);
        setError(null);
        setHasFetched(false);
      }

      fetchedForFilterRef.current = fetchKey;

      const timeoutId = setTimeout(() => {
        fetchTracks();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    currentInstanceId,
    fetchTracks,
    hasFetched,
    isUnlocked,
    loading,
    selectedPlaylistId,
    tracks
  ]);

  useEffect(() => {
    if (!isUnlocked || refreshToken === 0 || !hasFetched) return;
    fetchTracks();
  }, [fetchTracks, hasFetched, isUnlocked, refreshToken]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

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
      setContextMenu({ track, x: e.clientX, y: e.clientY });
    },
    []
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
    [softDeleteAudio, logError]
  );

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Audio</h2>
        </div>
        {isUnlocked && (
          <RefreshButton onClick={fetchTracks} loading={loading} size="sm" />
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
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
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audio...
          </div>
        ) : tracks.length === 0 && hasFetched ? (
          <div className="rounded-lg border p-6 text-center">
            {showDropzone && onUploadFiles ? (
              <div className="space-y-3">
                <Dropzone
                  onFilesSelected={onUploadFiles}
                  accept="audio/*"
                  multiple={false}
                  label="audio files"
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
                  <p className="font-medium text-sm">No audio files</p>
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
              placeholder="Search tracks..."
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
              <div ref={parentRef} className="h-full overflow-auto">
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
                label="audio files"
                source="media"
                compact
                variant="row"
              />
            )}
          </div>
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
            onClick={handleContextMenuInfo}
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
