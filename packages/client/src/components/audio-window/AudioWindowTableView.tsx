import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, asc, desc, eq, like } from 'drizzle-orm';
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '@/audio';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useAudioErrorHandler } from '@/hooks/useAudioErrorHandler';
import { useTypedTranslation } from '@/i18n';
import { detectPlatform, formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { logStore } from '@/stores/logStore';

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

type SortColumn = 'name' | 'size' | 'mimeType' | 'uploadDate';
type SortDirection = 'asc' | 'desc';

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

export function AudioWindowTableView() {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const { t } = useTypedTranslation('contextMenu');
  useAudioErrorHandler();
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

  const filteredTracks = tracks.filter((track) => {
    const searchLower = searchQuery.toLowerCase();
    return track.name.toLowerCase().includes(searchLower);
  });

  const isDesktopPlatform = useMemo(() => {
    const platform = detectPlatform();
    return platform === 'web' || platform === 'electron';
  }, []);

  const fetchTracks = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const orderByColumn = {
        name: files.name,
        size: files.size,
        mimeType: files.mimeType,
        uploadDate: files.uploadDate
      }[sortColumn];

      const orderFn = sortDirection === 'asc' ? asc : desc;

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
        .orderBy(orderFn(orderByColumn));

      const trackList: AudioInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

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
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: track.mimeType });
              const objectUrl = URL.createObjectURL(blob);

              let thumbnailUrl: string | null = null;
              if (track.thumbnailPath) {
                try {
                  const thumbData = await storage.measureRetrieve(
                    track.thumbnailPath,
                    logger
                  );
                  assertPlainArrayBuffer(thumbData);
                  const thumbBlob = new Blob([thumbData], {
                    type: 'image/jpeg'
                  });
                  thumbnailUrl = URL.createObjectURL(thumbBlob);
                } catch (err) {
                  logStore.warn(
                    `Failed to load thumbnail for ${track.name}`,
                    String(err)
                  );
                }
              }

              return { ...track, objectUrl, thumbnailUrl };
            } catch (err) {
              logStore.error(`Failed to load track ${track.name}`, String(err));
              return null;
            }
          })
        )
      ).filter((t): t is AudioWithUrl => t !== null);

      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      logStore.error('Failed to fetch tracks', String(err));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, sortColumn, sortDirection]);

  const fetchedForInstanceRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tracks intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
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
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchTracks();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchTracks]);

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
    setHasFetched(false);
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

  const handleContextMenuPlay = useCallback(
    (track: AudioWithUrl) => {
      handlePlayPause(track);
      setContextMenu(null);
    },
    [handlePlayPause]
  );

  const handleDelete = useCallback(async (trackToDelete: AudioWithUrl) => {
    setContextMenu(null);

    try {
      const db = getDatabase();

      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, trackToDelete.id));

      setTracks((prev) => {
        const remaining = prev.filter((t) => t.id !== trackToDelete.id);
        URL.revokeObjectURL(trackToDelete.objectUrl);
        if (trackToDelete.thumbnailUrl) {
          URL.revokeObjectURL(trackToDelete.thumbnailUrl);
        }
        return remaining;
      });
    } catch (err) {
      logStore.error('Failed to delete track', String(err));
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
              className="h-8"
              data-testid="window-audio-table-search"
            />
            <div className="flex-1 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">
                      <SortHeader
                        column="name"
                        label="Name"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <SortHeader
                        column="size"
                        label="Size"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <SortHeader
                        column="mimeType"
                        label="Type"
                        currentColumn={sortColumn}
                        direction={sortDirection}
                        onClick={handleSortChange}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-left">
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
                  {filteredTracks.map((track) => {
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isTrackPlaying = isCurrentTrack && isPlaying;

                    return (
                      <tr
                        key={track.id}
                        className={`cursor-pointer border-border/50 border-b hover:bg-accent/50 ${
                          isCurrentTrack ? 'bg-primary/5' : ''
                        }`}
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
                        data-testid={`window-audio-table-track-${track.id}`}
                      >
                        <td className="px-2 py-1.5">
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
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {formatFileSize(track.size)}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {getAudioTypeDisplay(track.mimeType)}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {formatDate(track.uploadDate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
            onClick={() => {
              window.open(`/audio/${contextMenu.track.id}`, '_blank');
              setContextMenu(null);
            }}
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
