import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowContextMenu,
  WindowTableRow
} from '@rapid/window-manager';
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../../context/AudioContext';
import {
  type AudioWithUrl,
  useAudioUIContext
} from '../../context/AudioUIContext';
import { setMediaDragData } from '../../lib/mediaDragData';
import { ALL_AUDIO_ID } from './AudioPlaylistsSidebar';

type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
type SortDirection = 'asc' | 'desc';

interface AudioWindowTableViewProps {
  onSelectTrack?: (trackId: string) => void;
  refreshToken?: number;
  selectedPlaylistId?: string | null;
  showDeleted?: boolean;
}

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onClick: (column: SortColumn) => void;
}

function SortHeader({
  column,
  label,
  currentColumn,
  direction,
  onClick
}: SortHeaderProps) {
  const isActive = column === currentColumn;

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
      onClick={() => onClick(column)}
    >
      {label}
      {isActive && (
        <span className="shrink-0">
          {direction === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      )}
    </button>
  );
}

function getAudioTypeDisplay(mimeType: string): string {
  const typeMap: Record<string, string> = {
    'audio/mpeg': 'MP3',
    'audio/wav': 'WAV',
    'audio/ogg': 'OGG',
    'audio/flac': 'FLAC',
    'audio/aac': 'AAC',
    'audio/mp4': 'M4A',
    'audio/x-m4a': 'M4A',
    'audio/webm': 'WebM'
  };

  if (typeMap[mimeType]) {
    return typeMap[mimeType];
  }

  const subtype = mimeType.split('/')[1];
  return subtype?.toUpperCase() ?? 'Audio';
}

export function AudioWindowTableView({
  onSelectTrack,
  refreshToken = 0,
  selectedPlaylistId,
  showDeleted = false
}: AudioWindowTableViewProps) {
  const {
    databaseState,
    ui,
    t,
    fetchAudioFilesWithUrls,
    getTrackIdsInPlaylist,
    softDeleteAudio,
    restoreAudio,
    formatFileSize,
    formatDate,
    logError,
    detectPlatform
  } = useAudioUIContext();
  const { isUnlocked, isLoading, currentInstanceId } = databaseState;
  const { RefreshButton, InlineUnlock, Input, AudioPlayer } = ui;

  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const currentTrackRef = useRef(currentTrack);
  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [contextMenu, setContextMenu] = useState<{
    track: AudioWithUrl;
    x: number;
    y: number;
  } | null>(null);

  const filteredAndSortedTracks = useMemo(() => {
    const filtered = tracks.filter((track) => {
      const searchLower = searchQuery.toLowerCase();
      return track.name.toLowerCase().includes(searchLower);
    });

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'mimeType':
          comparison = a.mimeType.localeCompare(b.mimeType);
          break;
        case 'uploadDate':
          comparison = a.uploadDate.getTime() - b.uploadDate.getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [tracks, searchQuery, sortColumn, sortDirection]);

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
        trackIds ?? undefined,
        showDeleted
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
    selectedPlaylistId,
    showDeleted
  ]);

  const fetchedForFilterRef = useRef<string | null>(null);

  useEffect(() => {
    const filterKey = selectedPlaylistId ?? ALL_AUDIO_ID;
    const fetchKey = `${currentInstanceId ?? 'none'}:${filterKey}:${showDeleted ? 'all' : 'active'}`;

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
    showDeleted,
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

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevColumn;
      }
      setSortDirection('asc');
      return column;
    });
  }, []);

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
    [logError, restoreAudio]
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
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <Music className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No audio files</p>
              <p className="text-muted-foreground text-xs">
                Upload audio from the main Audio page
              </p>
            </div>
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
              data-testid="window-audio-table-search"
            />
            <div className="flex-1 overflow-auto rounded-lg border">
              <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
                <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                  <tr>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="name"
                        label="Name"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="size"
                        label="Size"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="mimeType"
                        label="Type"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="uploadDate"
                        label="Date"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedTracks.map((track) => {
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isTrackPlaying = isCurrentTrack && isPlaying;

                    return (
                      <WindowTableRow
                        key={track.id}
                        isSelected={isCurrentTrack}
                        className={isCurrentTrack ? 'bg-primary/5' : undefined}
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
                        onContextMenu={(e) => handleContextMenu(e, track)}
                        draggable
                        onDragStart={(event) =>
                          setMediaDragData(event, 'audio', [track.id])
                        }
                        data-testid={`window-audio-table-track-${track.id}`}
                      >
                        <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                          <div className="flex items-center gap-1.5">
                            <div className="relative shrink-0">
                              {track.thumbnailUrl ? (
                                <img
                                  src={track.thumbnailUrl}
                                  alt=""
                                  className="h-4 w-4 rounded object-cover"
                                />
                              ) : (
                                <Music className="h-3 w-3 text-muted-foreground" />
                              )}
                              {isTrackPlaying && (
                                <div className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <Pause className="h-1.5 w-1.5" />
                                </div>
                              )}
                            </div>
                            <span className="truncate">{track.name}</span>
                          </div>
                        </td>
                        <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                          {formatFileSize(track.size)}
                        </td>
                        <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                          {getAudioTypeDisplay(track.mimeType)}
                        </td>
                        <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                          {formatDate(track.uploadDate)}
                        </td>
                      </WindowTableRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {contextMenu && (
        <WindowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {contextMenu.track.deleted ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => handleRestore(contextMenu.track)}
            >
              <RotateCcw className="h-4 w-4" />
              {t('restore')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleContextMenuPlay(contextMenu.track)}
              >
                {contextMenu.track.id === currentTrack?.id && isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {contextMenu.track.id === currentTrack?.id && isPlaying
                  ? t('pause')
                  : t('play')}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={handleContextMenuInfo}
              >
                <Info className="h-4 w-4" />
                {t('getInfo')}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive text-sm hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleDelete(contextMenu.track)}
              >
                <Trash2 className="h-4 w-4" />
                {t('delete')}
              </button>
            </>
          )}
        </WindowContextMenu>
      )}
    </div>
  );
}
