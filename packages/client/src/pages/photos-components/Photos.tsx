/**
 * Photos component - displays a grid of photos with context menu actions.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import { eq } from 'drizzle-orm';
import {
  Download,
  ImageIcon,
  Info,
  Loader2,
  Share2,
  Trash2
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/vfs';
import { useTypedTranslation } from '@/i18n';
import { uint8ArrayToDataUrl } from '@/lib/chatAttachments';
import { setAttachedImage } from '@/lib/llmRuntime';
import { setMediaDragData } from '@/lib/mediaDragData';
import { useNavigateWithFrom } from '@/lib/navigation';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import type { GridItem, PhotosProps, PhotoWithUrl } from './types';
import { IMAGE_MIME_TYPES, ROW_HEIGHT_ESTIMATE } from './types';
import { useColumnCount } from './useColumnCount';
import { usePhotosData } from './usePhotosData';
import { usePhotosFileActions } from './usePhotosFileActions';

export function Photos({
  onSelectPhoto,
  refreshToken,
  showBackLink = true,
  showDropzone = true,
  showDeleted = false,
  selectedAlbumId,
  onOpenAIChat
}: PhotosProps = {}) {
  const [searchParams] = useSearchParams();
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const [contextMenu, setContextMenu] = useState<{
    photo: PhotoWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount();

  const resolvedAlbumId =
    selectedAlbumId !== undefined
      ? selectedAlbumId
      : (searchParams.get('album') ?? undefined);

  const {
    photos,
    loading,
    error,
    hasFetched,
    fetchPhotos,
    setHasFetched,
    setError
  } = usePhotosData({
    showDeleted,
    selectedAlbumId: resolvedAlbumId,
    refreshToken
  });

  const { canShare, handleDownload, handleShare } = usePhotosFileActions({
    setError
  });

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

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;
      setError(null);
      setUploading(true);
      setUploadProgress(0);

      const errors: string[] = [];
      const totalFiles = selectedFiles.length;
      let uploadedCount = 0;

      for (const [i, file] of selectedFiles.entries()) {
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          errors.push(
            `"${file.name}" has an unsupported format. Supported: ${IMAGE_MIME_TYPES.map((type) => type.replace('image/', '').toUpperCase()).join(', ')}.`
          );
          continue;
        }
        try {
          const fileProgressCallback = (progress: number) => {
            const overallProgress = ((i + progress / 100) / totalFiles) * 100;
            setUploadProgress(Math.round(overallProgress));
          };
          await uploadFile(file, fileProgressCallback);
          uploadedCount++;
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
          errors.push(
            `"${file.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      if (uploadedCount > 0) {
        setHasFetched(false);
      }
      if (errors.length > 0) {
        setError(errors.join('\n'));
      }
      setUploading(false);
      setUploadProgress(0);
    },
    [uploadFile, setHasFetched, setError]
  );

  const handlePhotoClick = useCallback(
    (photo: PhotoWithUrl) => {
      if (onSelectPhoto) {
        onSelectPhoto(photo.id);
        return;
      }
      navigateWithFrom(`/photos/${photo.id}`, { fromLabel: 'Back to Photos' });
    },
    [navigateWithFrom, onSelectPhoto]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, photo: PhotoWithUrl) => {
      e.preventDefault();
      setContextMenu({ photo, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      if (onSelectPhoto) {
        onSelectPhoto(contextMenu.photo.id);
      } else {
        navigateWithFrom(`/photos/${contextMenu.photo.id}`, {
          fromLabel: 'Back to Photos'
        });
      }
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom, onSelectPhoto]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, contextMenu.photo.id));
      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete photo:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, setHasFetched, setError]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openAIChat = useCallback(() => {
    if (onOpenAIChat) {
      onOpenAIChat();
      return;
    }
    navigateWithFrom('/chat', { fromLabel: 'Back to Photos' });
  }, [navigateWithFrom, onOpenAIChat]);

  const handleAddToAIChat = useCallback(async () => {
    if (!contextMenu) return;
    try {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');
      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }
      const storage = getFileStorage();
      const data = await storage.retrieve(contextMenu.photo.storagePath);
      const imageDataUrl = await uint8ArrayToDataUrl(
        data,
        contextMenu.photo.mimeType
      );
      setAttachedImage(imageDataUrl);
      openAIChat();
    } catch (err) {
      console.error('Failed to add photo to AI chat:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, currentInstanceId, openAIChat, setError]);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Photos</h1>
          </div>
          {isUnlocked && (
            <RefreshButton onClick={fetchPhotos} loading={loading} />
          )}
        </div>
      </div>

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
        ) : uploading ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Uploading...</p>
            </div>
            <UploadProgress progress={uploadProgress} />
          </div>
        ) : photos.length === 0 && hasFetched ? (
          showDropzone ? (
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="image/*"
              multiple={true}
              disabled={uploading}
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
              firstVisible={firstVisible}
              lastVisible={lastVisible}
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
                              disabled={uploading}
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
                              onContextMenu={(e) => handleContextMenu(e, item)}
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
  );
}
