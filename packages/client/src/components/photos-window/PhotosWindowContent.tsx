import { useVirtualizer } from '@tanstack/react-virtual';
import { eq } from 'drizzle-orm';
import { Download, ImageIcon, Info, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { ListRow } from '@/components/ui/list-row';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { files } from '@/db/schema';
import { useVirtualVisibleRange } from '@/hooks/useVirtualVisibleRange';
import { useTypedTranslation } from '@/i18n';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatFileSize } from '@/lib/utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import {
  type PhotoWithUrl,
  usePhotosWindowData
} from './usePhotosWindowData';

const ROW_HEIGHT_ESTIMATE = 72;

interface PhotosWindowContentProps {
  onSelectPhoto?: (photoId: string) => void;
  refreshToken: number;
}

export function PhotosWindowContent({
  onSelectPhoto,
  refreshToken
}: PhotosWindowContentProps) {
  const { t } = useTypedTranslation('contextMenu');
  const {
    photos,
    loading,
    error,
    hasFetched,
    isUnlocked,
    isLoading,
    refresh,
    currentInstanceId
  } = usePhotosWindowData({ refreshToken });
  const [contextMenu, setContextMenu] = useState<{
    photo: PhotoWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const [canShare, setCanShare] = useState(false);
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
      setContextMenu({ photo, x: event.clientX, y: event.clientY });
    },
    []
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
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, contextMenu.photo.id));
      await refresh();
    } catch (err) {
      console.error('Failed to delete photo:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, refresh]);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');

        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized(currentInstanceId)) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        downloadFile(data, photo.name);
      } catch (err) {
        console.error('Failed to download photo:', err);
      }
    },
    []
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl, event?: React.MouseEvent) => {
      event?.stopPropagation();

      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');

        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized(currentInstanceId)) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        const data = await storage.retrieve(photo.storagePath);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share photo:', err);
      }
    },
    []
  );

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
          ) : photos.length === 0 && hasFetched ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-xs">
              No photos yet. Use Upload to add images.
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
                <div ref={parentRef} className="h-full overflow-auto">
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
                          <ListRow onContextMenu={(e) => handleContextMenu(e, photo)}>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
                              onClick={() => handleSelect(photo)}
                            >
                              <img
                                src={photo.objectUrl}
                                alt=""
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
                                  onClick={(event) =>
                                    handleShare(photo, event)
                                  }
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
        </div>
      )}

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
          <ContextMenuItem
            icon={<Download className="h-4 w-4" />}
            onClick={() => handleDownload(contextMenu.photo)}
          >
            {t('download')}
          </ContextMenuItem>
          {canShare && (
            <ContextMenuItem
              icon={<Share2 className="h-4 w-4" />}
              onClick={() => handleShare(contextMenu.photo)}
            >
              Share
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
