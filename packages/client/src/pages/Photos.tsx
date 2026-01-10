import { assertPlainArrayBuffer } from '@rapid/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { and, desc, eq, like } from 'drizzle-orm';
import { Download, ImageIcon, Info, Loader2, Share2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { useNavigateWithFrom } from '@/lib/navigation';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

// Only include formats that have thumbnail generation support
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

interface PhotoInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  thumbnailPath: string | null;
}

interface PhotoWithUrl extends PhotoInfo {
  objectUrl: string;
}

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

export function Photos() {
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount();

  const photoRows = useMemo(() => {
    const rows: PhotoWithUrl[][] = [];
    for (let i = 0; i < photos.length; i += columns) {
      rows.push(photos.slice(i, i + columns));
    }
    return rows;
  }, [photos, columns]);

  const virtualizer = useVirtualizer({
    count: photoRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 2
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Check if Web Share API is available on mount
  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();

      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        // Use full image, not thumbnail
        const data = await storage.retrieve(photo.storagePath);
        downloadFile(data, photo.name);
      } catch (err) {
        console.error('Failed to download photo:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId]
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();

      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        // Use full image, not thumbnail
        const data = await storage.retrieve(photo.storagePath);
        await shareFile(data, photo.name, photo.mimeType);
      } catch (err) {
        // User cancelled share - don't show error
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share photo:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId]
  );

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
        // Validate that the file type is one of the supported image MIME types
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          errors.push(
            `"${file.name}" has an unsupported format. Supported: JPEG, PNG, GIF, WebP.`
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

      // Refresh photos if any uploads succeeded
      if (uploadedCount > 0) {
        setHasFetched(false);
      }

      // Show errors if any occurred
      if (errors.length > 0) {
        setError(errors.join('\n'));
      }

      setUploading(false);
      setUploadProgress(0);
    },
    [uploadFile]
  );

  const fetchPhotos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(and(like(files.mimeType, 'image/%'), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate));

      const photoList: PhotoInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      // Load image data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const photosWithUrls = (
        await Promise.all(
          photoList.map(async (photo) => {
            try {
              // Prefer thumbnail for gallery view, fall back to full image
              const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
              const mimeType = photo.thumbnailPath
                ? 'image/jpeg'
                : photo.mimeType;
              const data = await storage.retrieve(pathToLoad);
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: mimeType });
              const objectUrl = URL.createObjectURL(blob);
              return { ...photo, objectUrl };
            } catch (err) {
              console.error(`Failed to load photo ${photo.name}:`, err);
              return null;
            }
          })
        )
      ).filter((p): p is PhotoWithUrl => p !== null);

      setPhotos(photosWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch photos:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId]);

  // Track the instance ID for which we've fetched photos
  // Using a ref avoids React's state batching issues
  const fetchedForInstanceRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: photos intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      // If instance changed, cleanup old object URLs first
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const photo of photos) {
          URL.revokeObjectURL(photo.objectUrl);
        }
        setPhotos([]);
        setError(null);
      }

      // Update ref before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchPhotos();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchPhotos]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const p of photos) {
        URL.revokeObjectURL(p.objectUrl);
      }
    };
  }, [photos]);

  const handlePhotoClick = useCallback(
    (photo: PhotoWithUrl) => {
      navigateWithFrom(`/photos/${photo.id}`, { fromLabel: 'Back to Photos' });
    },
    [navigateWithFrom]
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
      navigateWithFrom(`/photos/${contextMenu.photo.id}`, {
        fromLabel: 'Back to Photos'
      });
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Photos</h1>
        </div>
        {isUnlocked && (
          <RefreshButton onClick={fetchPhotos} loading={loading} />
        )}
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
              <p className="text-muted-foreground text-sm">
                {uploadProgress}% complete
              </p>
            </div>
          </div>
        ) : photos.length === 0 && hasFetched ? (
          <Dropzone
            onFilesSelected={handleFilesSelected}
            accept="image/*"
            multiple={true}
            disabled={uploading}
            label="photos"
            source="photos"
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            <p className="text-muted-foreground text-sm">
              {photos.length} photo{photos.length !== 1 && 's'}
            </p>
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
                        {row.map((photo) => (
                          // biome-ignore lint/a11y/useSemanticElements: Cannot use button here because this container has nested Download/Share buttons
                          <div
                            key={photo.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handlePhotoClick(photo)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handlePhotoClick(photo);
                              }
                            }}
                            onContextMenu={(e) => handleContextMenu(e, photo)}
                            className="group relative cursor-pointer overflow-hidden rounded-lg border bg-muted transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
                            style={{ aspectRatio: '1 / 1' }}
                          >
                            <img
                              src={photo.objectUrl}
                              alt={photo.name}
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                              <div className="flex items-center gap-1">
                                <p className="min-w-0 flex-1 truncate text-white text-xs">
                                  {photo.name}
                                </p>
                                <button
                                  type="button"
                                  onClick={(e) => handleDownload(photo, e)}
                                  className="shrink-0 rounded p-1 text-white/80 hover:bg-white/20 hover:text-white"
                                  title="Download"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                                {canShare && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleShare(photo, e)}
                                    className="shrink-0 rounded p-1 text-white/80 hover:bg-white/20 hover:text-white"
                                    title="Share"
                                  >
                                    <Share2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="image/*"
              multiple={true}
              disabled={uploading}
              label="photos"
              source="photos"
              compact
            />
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
            Get info
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
