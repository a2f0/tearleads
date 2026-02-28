import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, Music, Pause } from 'lucide-react';
import { AudioPlayer } from '@/components/audio/AudioPlayer';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/ListRow';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatFileSize } from '@/lib/utils';
import type { AudioWithUrl } from './types';

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

export function AudioTrackList({
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
                    onContextMenu={(event) => handleContextMenu(event, track)}
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
                        {isTrackPlaying ? (
                          <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Pause className="h-2.5 w-2.5" />
                          </div>
                        ) : null}
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
