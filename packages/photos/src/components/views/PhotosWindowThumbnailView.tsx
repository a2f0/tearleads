import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { Download, Info, Loader2, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type PhotoWithUrl, usePhotosUIContext } from '../../context';

const ROW_HEIGHT_ESTIMATE = 120;

const getColumnCount = (width: number) => {
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
};

function useColumnCount() {
  const [columns, setColumns] = useState(() => {
    if (typeof window === 'undefined') return 3;
    return getColumnCount(window.innerWidth);
  });

  useEffect(() => {
    const handleResize = () => {
      setColumns(getColumnCount(window.innerWidth));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return columns;
}

type GridItem = PhotoWithUrl | 'dropzone';

export interface PhotosWindowThumbnailViewProps {
  refreshToken: number;
  onSelectPhoto?: (photoId: string) => void;
  showDropzone?: boolean;
  selectedAlbumId?: string | null;
  onOpenAIChat?: () => void;
  showDeleted?: boolean;
}

export function PhotosWindowThumbnailView({
  refreshToken,
  onSelectPhoto,
  showDropzone = true,
  selectedAlbumId,
  onOpenAIChat,
  showDeleted = false
}: PhotosWindowThumbnailViewProps) {
  const {
    t,
    ui,
    databaseState,
    fetchPhotos,
    softDeletePhoto,
    downloadPhotoData,
    sharePhotoData,
    downloadFile,
    shareFile,
    canShareFiles,
    setMediaDragData,
    uint8ArrayToDataUrl,
    setAttachedImage,
    logError
  } = usePhotosUIContext();

  const { InlineUnlock, VirtualListStatus, Dropzone } = ui;
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
  const [canShare, setCanShare] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount();

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

  const photoRows = useMemo(() => {
    const rows: GridItem[][] = [];
    const allItems: GridItem[] = showDropzone
      ? [...photos, 'dropzone']
      : photos;
    for (let i = 0; i < allItems.length; i += columns) {
      rows.push(allItems.slice(i, i + columns));
    }
    return rows;
  }, [photos, columns, showDropzone]);

  const virtualizer = useVirtualizer({
    count: photoRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 2
  });

  const virtualItems = virtualizer.getVirtualItems();

  const firstVisibleRow =
    virtualItems.length > 0 ? virtualItems[0]?.index : null;
  const lastVisibleRow =
    virtualItems.length > 0
      ? virtualItems[virtualItems.length - 1]?.index
      : null;

  const firstVisible =
    firstVisibleRow != null
      ? Math.min(firstVisibleRow * columns, photos.length - 1)
      : null;
  const lastVisible =
    lastVisibleRow != null
      ? Math.min((lastVisibleRow + 1) * columns - 1, photos.length - 1)
      : null;

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();

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
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();

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

  const handlePhotoClick = useCallback(
    (photo: PhotoWithUrl) => {
      onSelectPhoto?.(photo.id);
    },
    [onSelectPhoto]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, photo: PhotoWithUrl) => {
      e.preventDefault();
      setContextMenu({ photo, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      onSelectPhoto?.(contextMenu.photo.id);
      setContextMenu(null);
    }
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

  const handleFilesSelected = useCallback((_files: File[]) => {
    // File upload is handled by parent component through props
    // This is a placeholder for the dropzone component
  }, []);

  return (
    <div className="h-full overflow-auto p-3">
      <div className="flex h-full flex-col space-y-6">
        {isLoading && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        )}

        {!isLoading && !isUnlocked && <InlineUnlock description="photos" />}

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
            {error}
          </div>
        )}

        {isUnlocked &&
          !error &&
          (loading && !hasFetched ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading photos...
            </div>
          ) : photos.length === 0 && hasFetched ? (
            showDropzone ? (
              <Dropzone
                onFilesSelected={handleFilesSelected}
                accept="image/*"
                multiple={true}
                label="photos"
                source="photos"
              />
            ) : (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                No photos yet. Use Upload to add images.
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
              <VirtualListStatus
                firstVisible={firstVisible ?? 0}
                lastVisible={lastVisible ?? 0}
                loadedCount={photos.length}
                itemLabel="photo"
              />
              <div
                ref={parentRef}
                className="flex-1 overflow-auto rounded-lg border p-2"
                data-testid="photos-grid"
              >
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((virtualItem) => {
                    const row = photoRows[virtualItem.index];
                    if (!row) return null;

                    return (
                      <div
                        key={virtualItem.index}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full pb-2"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                          {row.map((item) =>
                            item === 'dropzone' ? (
                              <Dropzone
                                key="dropzone"
                                onFilesSelected={handleFilesSelected}
                                accept="image/*"
                                multiple={true}
                                label="photos"
                                source="photos"
                                compact
                              />
                            ) : (
                              // biome-ignore lint/a11y/useSemanticElements: Cannot use button here because this container has nested Download/Share buttons
                              <div
                                key={item.id}
                                role="button"
                                tabIndex={0}
                                draggable
                                onClick={() => handlePhotoClick(item)}
                                onDragStart={(event) =>
                                  setMediaDragData(event, 'image', [item.id])
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handlePhotoClick(item);
                                  }
                                }}
                                onContextMenu={(e) =>
                                  handleContextMenu(e, item)
                                }
                                className="group relative cursor-pointer overflow-hidden rounded-lg border bg-muted transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
                                style={{ aspectRatio: '1 / 1' }}
                              >
                                <img
                                  src={item.objectUrl}
                                  alt={item.name}
                                  className="absolute inset-0 h-full w-full object-cover"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                  <div className="flex items-center gap-1">
                                    <p className="min-w-0 flex-1 truncate text-white text-xs">
                                      {item.name}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={(e) => handleDownload(item, e)}
                                      className="shrink-0 rounded p-1 text-white/80 hover:bg-white/20 hover:text-white"
                                      title="Download"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </button>
                                    {canShare && (
                                      <button
                                        type="button"
                                        onClick={(e) => handleShare(item, e)}
                                        className="shrink-0 rounded p-1 text-white/80 hover:bg-white/20 hover:text-white"
                                        title="Share"
                                      >
                                        <Share2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
              icon={<Info className="h-4 w-4" />}
              onClick={handleGetInfo}
            >
              {t('getInfo')}
            </ContextMenuItem>
            <ContextMenuItem onClick={handleAddToAIChat}>
              Add to AI chat
            </ContextMenuItem>
            <ContextMenuItem
              icon={<Trash2 className="h-4 w-4" />}
              onClick={handleDelete}
            >
              {t('delete')}
            </ContextMenuItem>
          </ContextMenu>
        )}
      </div>
    </div>
  );
}
