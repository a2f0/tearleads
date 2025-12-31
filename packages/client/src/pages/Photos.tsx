import { and, desc, eq, like } from 'drizzle-orm';
import {
  Database,
  Download,
  ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Share2
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { DEFAULT_THUMBNAIL_OPTIONS } from '@/lib/thumbnail';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

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

export function Photos() {
  const navigate = useNavigate();
  const { isUnlocked, isLoading } = useDatabaseContext();
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

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey);
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
    []
  );

  const handleShare = useCallback(
    async (photo: PhotoWithUrl, e: React.MouseEvent) => {
      e.stopPropagation();

      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey);
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
    []
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

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
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
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: mimeType });
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
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchPhotos();
    }
  }, [isUnlocked, hasFetched, loading, fetchPhotos]);

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
      navigate(`/photos/${photo.id}`);
    },
    [navigate]
  );

  const thumbnailStyle = {
    width: DEFAULT_THUMBNAIL_OPTIONS.maxWidth,
    height: DEFAULT_THUMBNAIL_OPTIONS.maxHeight
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, photo: PhotoWithUrl) => {
      e.preventDefault();
      setContextMenu({ photo, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      navigate(`/photos/${contextMenu.photo.id}`);
      setContextMenu(null);
    }
  }, [contextMenu, navigate]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Photos</h1>
        </div>
        {isUnlocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPhotos}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view photos.
          </p>
        </div>
      )}

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
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            No photos found. Upload images from the Files page to see them here.
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {photos.map((photo) => (
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
                style={thumbnailStyle}
              >
                <img
                  src={photo.objectUrl}
                  alt={photo.name}
                  className="h-full w-full object-cover"
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
