import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, Loader2, Share2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/ListRow';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useVirtualVisibleRange } from '@/hooks/device';
import { useTypedTranslation } from '@/i18n';
import { uint8ArrayToDataUrl } from '@/lib/chatAttachments';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import { setAttachedImage } from '@/lib/llmRuntime';
import { setMediaDragData } from '@/lib/mediaDragData';
import { formatFileSize } from '@/lib/utils';
import { PhotosContentContextMenus } from './PhotosContentContextMenus';
import { PhotosContentHeader } from './PhotosContentHeader';
import { type PhotoWithUrl, usePhotosWindowData } from './usePhotosWindowData';

const ROW_HEIGHT_ESTIMATE = 72;

interface PhotosWindowContentProps {
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
  const { t } = useTypedTranslation('contextMenu');
  const {
    photos,
    loading,
    error,
    hasFetched,
    isUnlocked,
    isLoading,
    deletePhoto,
    restorePhoto,
    downloadPhoto,
    sharePhoto
  } = usePhotosWindowData({ refreshToken, selectedAlbumId, showDeleted });
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
  const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

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
      await deletePhoto(contextMenu.photo.id);
    } catch (err) {
      console.error('Failed to delete photo:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, deletePhoto]);

  const handleRestore = useCallback(async () => {
    if (!contextMenu) return;

    try {
      await restorePhoto(contextMenu.photo.id);
    } catch (err) {
      console.error('Failed to restore photo:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, restorePhoto]);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

      try {
        const data = await downloadPhoto(photo);
        downloadFile(data, photo.name);
      } catch (err) {
        console.error('Failed to download photo:', err);
      }
    },
    [downloadPhoto]
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

      try {
        const data = await sharePhoto(photo);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share photo:', err);
      }
    },
    [sharePhoto]
  );

  const handleAddToAIChat = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const data = await downloadPhoto(contextMenu.photo);
      const imageDataUrl = await uint8ArrayToDataUrl(
        data,
        contextMenu.photo.mimeType
      );
      setAttachedImage(imageDataUrl);
      onOpenAIChat?.();
    } catch (err) {
      console.error('Failed to add photo to AI chat:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, downloadPhoto, onOpenAIChat]);

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
