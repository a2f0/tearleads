import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ImageIcon,
  Info,
  RotateCcw,
  Share2,
  Trash2,
  Upload
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type PhotoWithUrl, usePhotosUIContext } from '../../context';
import {
  getPhotoTypeDisplay,
  type PhotosWindowTableViewProps,
  type SortColumn,
  type SortDirection,
  type SortHeaderProps
} from './photosTableHelpers';

// Re-export props type for backwards compatibility
export type { PhotosWindowTableViewProps } from './photosTableHelpers';

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

export function PhotosWindowTableView({
  onSelectPhoto,
  refreshToken,
  selectedAlbumId,
  onOpenAIChat,
  showDeleted = false,
  onUpload
}: PhotosWindowTableViewProps) {
  const {
    t,
    ui,
    databaseState,
    fetchPhotos,
    softDeletePhoto,
    restorePhoto,
    downloadPhotoData,
    sharePhotoData,
    downloadFile,
    shareFile,
    canShareFiles,
    formatFileSize,
    setMediaDragData,
    uint8ArrayToDataUrl,
    setAttachedImage,
    logError
  } = usePhotosUIContext();

  const { InlineUnlock, ContextMenu, ContextMenuItem } = ui;
  const { isUnlocked, isLoading } = databaseState;

  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    photo: PhotoWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    setCanShare(canShareFiles());
  }, [canShareFiles]);

  const fetchData = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const fetchedPhotos = await fetchPhotos({
        albumId: selectedAlbumId ?? null,
        includeDeleted: showDeleted
      });
      setPhotos(fetchedPhotos);
      setHasFetched(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError('Failed to fetch photos', message);
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, fetchPhotos, selectedAlbumId, showDeleted, logError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken prop intentionally triggers re-fetch
  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshToken]);

  const sortedPhotos = useMemo(() => {
    const sorted = [...photos].sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return a.size - b.size;
        case 'mimeType':
          return a.mimeType.localeCompare(b.mimeType);
        case 'uploadDate':
          return a.uploadDate.getTime() - b.uploadDate.getTime();
        default:
          return 0;
      }
    });
    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [photos, sortColumn, sortDirection]);

  const handleSortChange = useCallback(
    (column: SortColumn) => {
      if (column === sortColumn) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortColumn(column);
      setSortDirection('asc');
    },
    [sortColumn]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, photo: PhotoWithUrl) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ photo, x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleBlankSpaceContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!onUpload) return;
      event.preventDefault();
      setBlankSpaceMenu({ x: event.clientX, y: event.clientY });
    },
    [onUpload]
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGetInfo = useCallback(() => {
    if (!contextMenu) return;
    onSelectPhoto?.(contextMenu.photo.id);
    setContextMenu(null);
  }, [contextMenu, onSelectPhoto]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      await softDeletePhoto(contextMenu.photo.id);
      void fetchData();
    } catch (err) {
      logError(
        'Failed to delete photo',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, softDeletePhoto, fetchData, logError]);

  const handleRestore = useCallback(async () => {
    if (!contextMenu) return;

    try {
      await restorePhoto(contextMenu.photo.id);
      void fetchData();
    } catch (err) {
      logError(
        'Failed to restore photo',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, restorePhoto, fetchData, logError]);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl) => {
      try {
        const data = await downloadPhotoData(photo);
        downloadFile(data, photo.name);
      } catch (err) {
        logError(
          'Failed to download photo',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
    [downloadPhotoData, downloadFile, logError]
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl) => {
      try {
        const data = await sharePhotoData(photo);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        logError(
          'Failed to share photo',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
    [sharePhotoData, shareFile, logError]
  );

  const handleAddToAIChat = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const data = await downloadPhotoData(contextMenu.photo);
      const imageDataUrl = await uint8ArrayToDataUrl(
        data,
        contextMenu.photo.mimeType
      );
      setAttachedImage?.(imageDataUrl);
      onOpenAIChat?.();
    } catch (err) {
      logError(
        'Failed to add photo to AI chat',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setContextMenu(null);
    }
  }, [
    contextMenu,
    downloadPhotoData,
    uint8ArrayToDataUrl,
    setAttachedImage,
    onOpenAIChat,
    logError
  ]);

  return (
    <div className="flex h-full flex-col space-y-2 p-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <p className="font-medium text-sm">Photos</p>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="photos" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <div className="flex min-h-0 flex-1 flex-col">
          {loading && !hasFetched ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-xs">
              Loading photos...
            </div>
          ) : sortedPhotos.length === 0 && hasFetched ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
            <div
              className="rounded-lg border p-6 text-center text-muted-foreground text-xs"
              onContextMenu={handleBlankSpaceContextMenu}
            >
              No photos yet. Use Upload to add images.
            </div>
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space
            <div
              className="flex-1 overflow-auto rounded-lg border"
              data-testid="photos-table-container"
              onContextMenu={handleBlankSpaceContextMenu}
            >
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
                  {sortedPhotos.map((photo) => (
                    <WindowTableRow
                      key={photo.id}
                      onClick={() => onSelectPhoto?.(photo.id)}
                      onContextMenu={(event) => handleContextMenu(event, photo)}
                      draggable
                      onDragStart={(event) =>
                        setMediaDragData(event, 'image', [photo.id])
                      }
                    >
                      <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                        <div className="flex items-center gap-1.5">
                          <img
                            src={photo.objectUrl}
                            alt={photo.name}
                            className="h-5 w-5 shrink-0 rounded object-cover"
                          />
                          <span className="truncate">{photo.name}</span>
                        </div>
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {formatFileSize(photo.size)}
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {getPhotoTypeDisplay(photo.mimeType)}
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                        {photo.uploadDate.toLocaleDateString()}
                      </td>
                    </WindowTableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {contextMenu.photo.deleted ? (
            <ContextMenuItem
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={handleRestore}
            >
              {t('restore')}
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                icon={<Info className="h-4 w-4" />}
                onClick={handleGetInfo}
              >
                {t('getInfo')}
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Download className="h-4 w-4" />}
                onClick={() => handleDownload(contextMenu.photo)}
              >
                {t('download')}
              </ContextMenuItem>
              <ContextMenuItem onClick={handleAddToAIChat}>
                Add to AI chat
              </ContextMenuItem>
              {canShare && (
                <ContextMenuItem
                  icon={<Share2 className="h-4 w-4" />}
                  onClick={() => handleShare(contextMenu.photo)}
                >
                  {t('share')}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                icon={<Trash2 className="h-4 w-4" />}
                onClick={handleDelete}
              >
                {t('delete')}
              </ContextMenuItem>
            </>
          )}
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
    </div>
  );
}
