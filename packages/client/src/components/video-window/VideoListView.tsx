import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { ChevronRight, Film, Info, Play, Trash2, Upload } from 'lucide-react';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/ListRow';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useVirtualVisibleRange } from '@/hooks/device';
import { useTypedTranslation } from '@/i18n';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatFileSize } from '@/lib/utils';
import type { VideoOpenOptions, VideoWithThumbnail } from '@/pages/Video';

const ROW_HEIGHT_ESTIMATE = 56;

interface VideoListViewProps {
  videos: VideoWithThumbnail[];
  parentRef: RefObject<HTMLDivElement | null>;
  isDesktopPlatform: boolean;
  onNavigateToDetail: (videoId: string, options?: VideoOpenOptions) => void;
  onPlay: (video: VideoWithThumbnail) => void;
  onGetInfo: (video: VideoWithThumbnail) => void;
  onDelete: (video: VideoWithThumbnail) => Promise<void>;
  onUpload?: (() => void) | undefined;
}

export function VideoListView({
  videos,
  parentRef,
  isDesktopPlatform,
  onNavigateToDetail,
  onPlay,
  onGetInfo,
  onDelete,
  onUpload
}: VideoListViewProps) {
  const { t } = useTypedTranslation('contextMenu');
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    video: VideoWithThumbnail;
    x: number;
    y: number;
  } | null>(null);

  const virtualizer = useVirtualizer({
    count: videos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

  const handleBlankSpaceContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      if ((e.target as HTMLElement).closest('[data-testid^="video-item-"]')) {
        return;
      }
      e.preventDefault();
      setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
    },
    [onUpload]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, video: VideoWithThumbnail) => {
      e.preventDefault();
      setContextMenu({ video, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePlay = useCallback(
    (video: VideoWithThumbnail) => {
      onPlay(video);
      setContextMenu(null);
    },
    [onPlay]
  );

  const handleGetInfo = useCallback(
    (video: VideoWithThumbnail) => {
      onGetInfo(video);
      setContextMenu(null);
    },
    [onGetInfo]
  );

  const handleDelete = useCallback(
    async (video: VideoWithThumbnail) => {
      setContextMenu(null);
      await onDelete(video);
    },
    [onDelete]
  );

  return (
    <>
      <VirtualListStatus
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        loadedCount={videos.length}
        itemLabel="video"
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
              const video = videos[virtualItem.index];
              if (!video) return null;

              return (
                <div
                  key={video.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-1 py-0.5"
                  style={{
                    transform: `translateY(${virtualItem.start}px)`
                  }}
                >
                  <ListRow
                    data-testid={`video-item-${video.id}`}
                    onContextMenu={(e) => handleContextMenu(e, video)}
                  >
                    <button
                      type="button"
                      onClick={
                        isDesktopPlatform
                          ? undefined
                          : () => onNavigateToDetail(video.id)
                      }
                      onDoubleClick={
                        isDesktopPlatform
                          ? () => onNavigateToDetail(video.id)
                          : undefined
                      }
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                      data-testid={`video-open-${video.id}`}
                      draggable
                      onDragStart={(event) =>
                        setMediaDragData(event, 'video', [video.id])
                      }
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
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-black/50">
                            <Play className="h-2 w-2 text-white" />
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">
                          {video.name}
                        </p>
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
            })}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Play className="h-4 w-4" />}
            onClick={() => handlePlay(contextMenu.video)}
          >
            {t('play')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={() => handleGetInfo(contextMenu.video)}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => handleDelete(contextMenu.video)}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {blankSpaceMenu && onUpload && (
        <ContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={() => setBlankSpaceMenu(null)}
        >
          <ContextMenuItem
            icon={<Upload className="h-4 w-4" />}
            onClick={() => {
              onUpload();
              setBlankSpaceMenu(null);
            }}
          >
            Upload
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
