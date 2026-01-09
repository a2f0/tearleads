import { and, desc, eq, like } from 'drizzle-orm';
import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { THUMBNAIL_DISPLAY_SIZE } from '@/lib/thumbnail';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

interface PhotoInfo {
  id: string;
  name: string;
  storagePath: string;
  thumbnailPath: string | null;
  objectUrl: string;
}

interface PhotoPickerProps {
  onSelect: (imageDataUrl: string) => void;
  onClose: () => void;
}

export function PhotoPicker({ onSelect, onClose }: PhotoPickerProps) {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(and(like(files.mimeType, 'image/%'), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate))
        .limit(50);

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
          result.map(async (photo) => {
            try {
              const pathToLoad = photo.thumbnailPath ?? photo.storagePath;
              const mimeType = photo.thumbnailPath
                ? 'image/jpeg'
                : 'image/jpeg';
              const data = await storage.retrieve(pathToLoad);
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: mimeType });
              const objectUrl = URL.createObjectURL(blob);
              return { ...photo, objectUrl };
            } catch {
              return null;
            }
          })
        )
      ).filter((p): p is PhotoInfo => p !== null);

      setPhotos(photosWithUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    return () => {
      for (const p of photos) {
        URL.revokeObjectURL(p.objectUrl);
      }
    };
  }, [photos]);

  const handleSelect = useCallback(
    async (photo: PhotoInfo) => {
      try {
        const keyManager = getKeyManager();
        const encryptionKey = keyManager.getCurrentKey();
        if (!encryptionKey) throw new Error('Database not unlocked');
        if (!currentInstanceId) throw new Error('No active instance');

        if (!isFileStorageInitialized()) {
          await initializeFileStorage(encryptionKey, currentInstanceId);
        }

        const storage = getFileStorage();
        // Load full image for sending to the model
        const data = await storage.retrieve(photo.storagePath);
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        const blob = new Blob([buffer], { type: 'image/jpeg' });

        // Convert to base64 data URL
        const reader = new FileReader();
        reader.onload = () => {
          const { result } = reader;
          if (typeof result === 'string') {
            onSelect(result);
            return;
          }
          setError('Failed to load photo for selection.');
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [onSelect, currentInstanceId]
  );

  const thumbnailStyle = {
    width: THUMBNAIL_DISPLAY_SIZE,
    height: THUMBNAIL_DISPLAY_SIZE
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Select a Photo</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading photos...
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
              {error}
            </div>
          )}
          {!loading && !error && photos.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No photos found. Upload images from the Files page first.
            </div>
          )}
          {!loading && !error && photos.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => handleSelect(photo)}
                  className="overflow-hidden rounded-lg border transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
                  style={thumbnailStyle}
                >
                  <img
                    src={photo.objectUrl}
                    alt={photo.name}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
