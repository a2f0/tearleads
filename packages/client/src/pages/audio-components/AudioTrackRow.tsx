import { ChevronRight, Music, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/ListRow';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatFileSize } from '@/lib/utils';
import type { AudioWithUrl } from './types';

interface AudioTrackRowProps {
  track: AudioWithUrl;
  start: number;
  index: number;
  measureElement: (node: HTMLDivElement | null) => void;
  isCurrentTrack: boolean;
  isTrackPlaying: boolean;
  isDesktopPlatform: boolean;
  onPlayPause: (track: AudioWithUrl) => void;
  onNavigateToDetail: (trackId: string) => void;
  onContextMenu: (event: React.MouseEvent, track: AudioWithUrl) => void;
}

export function AudioTrackRow({
  track,
  start,
  index,
  measureElement,
  isCurrentTrack,
  isTrackPlaying,
  isDesktopPlatform,
  onPlayPause,
  onNavigateToDetail,
  onContextMenu
}: AudioTrackRowProps) {
  return (
    <div
      data-index={index}
      ref={measureElement}
      className="absolute top-0 left-0 w-full px-1 py-0.5"
      style={{
        transform: `translateY(${start}px)`
      }}
    >
      <ListRow
        className={`${isCurrentTrack ? 'border-primary bg-primary/5' : ''}`}
        data-testid={`audio-track-${track.id}`}
        onContextMenu={(event) => onContextMenu(event, track)}
      >
        <button
          type="button"
          onClick={isDesktopPlatform ? undefined : () => onPlayPause(track)}
          onDoubleClick={
            isDesktopPlatform ? () => onPlayPause(track) : undefined
          }
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
          data-testid={`audio-play-${track.id}`}
          draggable
          onDragStart={(event) => setMediaDragData(event, 'audio', [track.id])}
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
            <p className="truncate font-medium text-sm">{track.name}</p>
            <p className="text-muted-foreground text-xs">
              {formatFileSize(track.size)}
            </p>
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onNavigateToDetail(track.id)}
          aria-label="View details"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </ListRow>
    </div>
  );
}
