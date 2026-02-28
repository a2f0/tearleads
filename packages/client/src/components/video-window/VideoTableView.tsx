import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useVirtualVisibleRange } from '@/hooks/device';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatDate, formatFileSize, getVideoTypeDisplay } from '@/lib/utils';
import type { VideoOpenOptions, VideoWithThumbnail } from '@/pages/Video';
import { VideoContextMenus } from './VideoContextMenus';
import { VideoNameCell } from './VideoNameCell';

const TABLE_ROW_HEIGHT_ESTIMATE = 44;

interface VideoTableViewProps {
  videos: VideoWithThumbnail[];
  tableParentRef: RefObject<HTMLDivElement | null>;
  isDesktopPlatform: boolean;
  onNavigateToDetail: (videoId: string, options?: VideoOpenOptions) => void;
  onPlay: (video: VideoWithThumbnail) => void;
  onGetInfo: (video: VideoWithThumbnail) => void;
  onDelete: (video: VideoWithThumbnail) => Promise<void>;
  onUpload?: (() => void) | undefined;
}

const VIDEO_TABLE_COLUMNS: ColumnDef<VideoWithThumbnail>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: ({ row }) => <VideoNameCell video={row.original} />
  },
  {
    id: 'size',
    header: 'Size',
    cell: ({ row }) => formatFileSize(row.original.size)
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => getVideoTypeDisplay(row.original.mimeType)
  },
  {
    id: 'uploaded',
    header: 'Uploaded',
    cell: ({ row }) => formatDate(row.original.uploadDate)
  }
];

export function VideoTableView({
  videos,
  tableParentRef,
  isDesktopPlatform,
  onNavigateToDetail,
  onPlay,
  onGetInfo,
  onDelete,
  onUpload
}: VideoTableViewProps) {
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    video: VideoWithThumbnail;
    x: number;
    y: number;
  } | null>(null);

  const table = useReactTable({
    data: videos,
    columns: VIDEO_TABLE_COLUMNS,
    getCoreRowModel: getCoreRowModel()
  });

  const tableVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => TABLE_ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const tableVirtualItems = tableVirtualizer.getVirtualItems();
  const { firstVisible: tableFirstVisible, lastVisible: tableLastVisible } =
    useVirtualVisibleRange(tableVirtualItems);

  const getTableCellClassName = useCallback((columnId: string) => {
    if (columnId === 'name') {
      return 'px-3 py-2';
    }
    return 'px-3 py-2 text-muted-foreground';
  }, []);

  const handleBlankSpaceContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      if ((e.target as HTMLElement).closest('tr')) {
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
        firstVisible={tableFirstVisible}
        lastVisible={tableLastVisible}
        loadedCount={videos.length}
        itemLabel="video"
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
      <div
        ref={tableParentRef}
        className="flex-1 overflow-auto rounded-lg border"
        onContextMenu={handleBlankSpaceContextMenu}
      >
        <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
          <thead
            className={`sticky top-0 z-10 bg-muted/60 text-muted-foreground ${WINDOW_TABLE_TYPOGRAPHY.header}`}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={WINDOW_TABLE_TYPOGRAPHY.headerCell}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              height: `${tableVirtualizer.getTotalSize()}px`,
              position: 'relative'
            }}
          >
            {tableVirtualItems.map((virtualRow) => {
              const row = table.getRowModel().rows[virtualRow.index];
              if (!row) return null;
              const video = row.original;

              return (
                <WindowTableRow
                  key={row.id}
                  ref={tableVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  onContextMenu={(e) => handleContextMenu(e, video)}
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
                  draggable
                  onDragStart={(event) =>
                    setMediaDragData(event, 'video', [video.id])
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={getTableCellClassName(cell.column.id)}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </WindowTableRow>
              );
            })}
          </tbody>
        </table>
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
