import { ChevronRight, Film, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/ListRow';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatFileSize } from '@/lib/utils';
import type { VideoOpenOptions, VideoWithThumbnail } from '@/pages/Video';

interface VideoListRowProps {
  video: VideoWithThumbnail;
  index: number;
  start: number;
  measureElement: (node: HTMLDivElement | null) => void;
  isDesktopPlatform: boolean;
  onNavigateToDetail: (videoId: string, options?: VideoOpenOptions) => void;
  onContextMenu: (event: React.MouseEvent, video: VideoWithThumbnail) => void;
}

export function VideoListRow({
  video,
  index,
  start,
  measureElement,
  isDesktopPlatform,
  onNavigateToDetail,
  onContextMenu
}: VideoListRowProps) {
  return (
    <div
      data-index={index}
      ref={measureElement}
      className="absolute top-0 left-0 w-full px-1 py-0.5"
      style={{ transform: `translateY(${start}px)` }}
    >
      <ListRow
        data-testid={`video-item-${video.id}`}
        onContextMenu={(event) => onContextMenu(event, video)}
      >
        <button
          type="button"
          onClick={
            isDesktopPlatform ? undefined : () => onNavigateToDetail(video.id)
          }
          onDoubleClick={
            isDesktopPlatform ? () => onNavigateToDetail(video.id) : undefined
          }
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
          data-testid={`video-open-${video.id}`}
          draggable
          onDragStart={(event) => setMediaDragData(event, 'video', [video.id])}
        >
          <div className="relative shrink-0">
            {video.thumbnailUrl ? (
              <img
                src={video.thumbnailUrl}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            ) : (
              <Film className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="absolute inset-0 m-auto inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/50">
              <Play className="h-2 w-2 text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{video.name}</p>
            <p className="text-muted-foreground text-xs">
              {formatFileSize(video.size)}
            </p>
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onNavigateToDetail(video.id)}
          aria-label="View details"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </ListRow>
    </div>
  );
}
