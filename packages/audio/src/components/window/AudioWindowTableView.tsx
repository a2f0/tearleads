import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowContextMenu,
  WindowTableRow
} from '@tearleads/window-manager';
import {
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudio } from '../../context/AudioContext';
import {
  type AudioWithUrl,
  useAudioUIContext
} from '../../context/AudioUIContext';
import { setMediaDragData } from '../../lib/mediaDragData';
import {
  type AudioWindowTableViewProps,
  type ContextMenuState,
  getAudioTypeDisplay,
  SortHeader,
  useAudioTableData,
  useAudioTableSort
} from './audio-table';

export function AudioWindowTableView({
  onSelectTrack,
  refreshToken = 0,
  selectedPlaylistId,
  selectedAlbumId: _selectedAlbumId,
  onAlbumSelect: _onAlbumSelect,
  showDeleted = false
}: AudioWindowTableViewProps) {
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
    formatDate,
    logError,
    detectPlatform
  } = useAudioUIContext();
  const { isUnlocked, isLoading } = databaseState;
  const { RefreshButton, InlineUnlock, Input, AudioPlayer } = ui;

  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  const {
    sortColumn,
    sortDirection,
    filteredAndSortedTracks,
    handleSortChange
  } = useAudioTableSort(tracks, searchQuery);

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, [detectPlatform]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack, currentTrackRef]);

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">{t('audio')}</h2>
        </div>
        {isUnlocked && (
          <RefreshButton onClick={fetchTracks} loading={loading} size="sm" />
        )}
      </div>

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
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loadingAudio')}
          </div>
        ) : tracks.length === 0 && hasFetched ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <Music className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{t('noAudioFiles')}</p>
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
              placeholder={t('searchTracks')}
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
                        label={t('name')}
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="size"
                        label={t('size')}
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="mimeType"
                        label={t('type')}
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      <SortHeader
                        column="uploadDate"
                        label={t('date')}
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
