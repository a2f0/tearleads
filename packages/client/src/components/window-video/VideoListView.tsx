import { useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useVirtualVisibleRange } from '@/hooks/device';
import type { VideoOpenOptions, VideoWithThumbnail } from '@/pages/Video';
import { VideoContextMenus } from './VideoContextMenus';
import { VideoListRow } from './VideoListRow';

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
                <VideoListRow
                  key={video.id}
                  video={video}
                  index={virtualItem.index}
                  start={virtualItem.start}
                  measureElement={virtualizer.measureElement}
                  isDesktopPlatform={isDesktopPlatform}
                  onNavigateToDetail={onNavigateToDetail}
                  onContextMenu={handleContextMenu}
                />
              );
            })}
          </div>
        </div>
      </div>

      <VideoContextMenus
        contextMenu={contextMenu}
        blankSpaceMenu={blankSpaceMenu}
        onCloseContextMenu={handleCloseContextMenu}
        onPlay={handlePlay}
        onGetInfo={handleGetInfo}
        onDelete={handleDelete}
        onUpload={onUpload}
        onCloseBlankSpaceMenu={() => setBlankSpaceMenu(null)}
      />
    </>
  );
}
