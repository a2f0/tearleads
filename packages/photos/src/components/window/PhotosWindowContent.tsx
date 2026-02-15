import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Loader2, Share2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type PhotoWithUrl, usePhotosUIContext } from '../../context';
import { PhotosContentContextMenus } from './PhotosContentContextMenus';
import { PhotosContentHeader } from './PhotosContentHeader';

const ROW_HEIGHT_ESTIMATE = 72;

export interface PhotosWindowContentProps {
  onSelectPhoto?: (photoId: string) => void;
  refreshToken: number;
  showDeleted?: boolean;
  showDropzone?: boolean;
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  selectedAlbumId?: string | null;
  uploading?: boolean;
  uploadProgress?: number;
  onUpload?: () => void;
  onOpenAIChat?: () => void;
}

export function PhotosWindowContent({
  onSelectPhoto,
  refreshToken,
  showDeleted = false,
  showDropzone = false,
  onUploadFiles,
  selectedAlbumId,
  uploading = false,
  uploadProgress = 0,
  onUpload,
  onOpenAIChat
}: PhotosWindowContentProps) {
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

  const {
    Button,
    ListRow,
    VirtualListStatus,
    InlineUnlock,
    Dropzone,
    UploadProgress
  } = ui;

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
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: photos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Calculate visible range
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? 0) + 1 : 0;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? 0) + 1
      : 0;

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

  const handleSelect = useCallback(
    (photo: PhotoWithUrl) => {
      onSelectPhoto?.(photo.id);
    },
    [onSelectPhoto]
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
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
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
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

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
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

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
      <PhotosContentHeader />

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
          {uploading ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Uploading...</p>
              </div>
              <UploadProgress progress={uploadProgress} />
            </div>
          ) : loading && !hasFetched ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-xs">
              Loading photos...
            </div>
          ) : photos.length === 0 && hasFetched ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
            <div
              className="rounded-lg border p-6 text-center"
              onContextMenu={handleBlankSpaceContextMenu}
            >
              {showDropzone && onUploadFiles ? (
                <Dropzone
                  onFilesSelected={onUploadFiles}
                  accept="image/*"
                  multiple={true}
                  label="photos"
                  source="photos"
                />
              ) : (
                <p className="text-muted-foreground text-xs">
                  No photos yet. Use Upload to add images.
                </p>
              )}
            </div>
          ) : (
            <>
              <VirtualListStatus
                firstVisible={firstVisible}
                lastVisible={lastVisible}
                loadedCount={photos.length}
                itemLabel="photo"
                className="mb-2"
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
                      const photo = photos[virtualItem.index];
                      if (!photo) return null;

                      return (
                        <div
                          key={photo.id}
                          data-index={virtualItem.index}
                          ref={virtualizer.measureElement}
                          className="absolute top-0 left-0 w-full px-1 py-0.5"
                          style={{
                            transform: `translateY(${virtualItem.start}px)`
                          }}
                        >
                          <ListRow
                            onContextMenu={(e) => handleContextMenu(e, photo)}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
                              onClick={() => handleSelect(photo)}
                              draggable
                              onDragStart={(event) =>
                                setMediaDragData(event, 'image', [photo.id])
                              }
                            >
                              <img
                                src={photo.objectUrl}
                                alt={photo.name}
                                className="h-10 w-10 shrink-0 rounded object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-sm">
                                  {photo.name}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {formatFileSize(photo.size)} ·{' '}
                                  {photo.uploadDate.toLocaleDateString()}
                                </p>
                              </div>
                            </button>
                            <div className="flex shrink-0 gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(event) =>
                                  handleDownload(photo, event)
                                }
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              {canShare && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(event) => handleShare(photo, event)}
                                  title="Share"
                                >
                                  <Share2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </ListRow>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
          {showDropzone && onUploadFiles && photos.length > 0 && (
            <Dropzone
              onFilesSelected={onUploadFiles}
              accept="image/*"
              multiple={true}
              label="photos"
              source="photos"
              compact
              variant="row"
            />
          )}
        </div>
      )}

      <PhotosContentContextMenus
        contextMenu={contextMenu}
        blankSpaceMenu={blankSpaceMenu}
        canShare={canShare}
        onCloseContextMenu={handleCloseContextMenu}
        onCloseBlankSpaceMenu={() => setBlankSpaceMenu(null)}
        onRestore={() => {
          void handleRestore();
        }}
        onGetInfo={handleGetInfo}
        onDownload={(photo) => {
          void handleDownload(photo);
        }}
        onAddToAIChat={() => {
          void handleAddToAIChat();
        }}
        onShare={(photo) => {
          void handleShare(photo);
        }}
        onDelete={() => {
          void handleDelete();
        }}
        onUpload={onUpload}
        labels={{
          restore: t('restore'),
          getInfo: t('getInfo'),
          download: t('download'),
          share: t('share'),
          delete: t('delete')
        }}
      />
    </div>
  );
}
