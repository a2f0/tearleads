import { Database, ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
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

  const fetchPhotos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      const result = await adapter.execute(
        `SELECT id, name, size, mime_type, upload_date, storage_path
         FROM files
         WHERE mime_type LIKE 'image/%' AND deleted = 0
         ORDER BY upload_date DESC`,
        []
      );

      const photoList: PhotoInfo[] = result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r['id'] as string,
          name: r['name'] as string,
          size: r['size'] as number,
          mimeType: r['mime_type'] as string,
          uploadDate: new Date(r['upload_date'] as number),
          storagePath: r['storage_path'] as string
        };
      });

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
              const data = await storage.retrieve(photo.storagePath);
              const buffer = new ArrayBuffer(data.byteLength);
              new Uint8Array(buffer).set(data);
              const blob = new Blob([buffer], { type: photo.mimeType });
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => handlePhotoClick(photo)}
                className="group relative aspect-square overflow-hidden rounded-lg border bg-muted transition-all hover:ring-2 hover:ring-primary hover:ring-offset-2"
              >
                <img
                  src={photo.objectUrl}
                  alt={photo.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <p className="truncate text-white text-xs">{photo.name}</p>
                </div>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
