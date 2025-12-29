import {
  ArrowLeft,
  Calendar,
  Database,
  FileType,
  HardDrive,
  Loader2
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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

function formatFileSize(bytes: number): string {
  if (bytes < 0) return 'Invalid size';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function PhotoDetail() {
  const { id } = useParams<{ id: string }>();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPhoto = useCallback(async () => {
    if (!isUnlocked || !id) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      const result = await adapter.execute(
        `SELECT id, name, size, mime_type, upload_date, storage_path
         FROM files
         WHERE id = ? AND mime_type LIKE 'image/%' AND deleted = 0`,
        [id]
      );

      if (result.rows.length === 0) {
        setError('Photo not found');
        return;
      }

      const row = result.rows[0] as Record<string, unknown>;
      const photoInfo: PhotoInfo = {
        id: row['id'] as string,
        name: row['name'] as string,
        size: row['size'] as number,
        mimeType: row['mime_type'] as string,
        uploadDate: new Date(row['upload_date'] as number),
        storagePath: row['storage_path'] as string
      };

      setPhoto(photoInfo);

      // Load image data and create object URL
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(photoInfo.storagePath);
      // Copy to ArrayBuffer for TypeScript compatibility with Blob constructor
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: photoInfo.mimeType });
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
    } catch (err) {
      console.error('Failed to fetch photo:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchPhoto();
    }
  }, [isUnlocked, id, fetchPhoto]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/photos"
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Photos
        </Link>
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
            Database is locked. Unlock it from the SQLite page to view this
            photo.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading photo...
        </div>
      )}

      {isUnlocked && !loading && !error && photo && (
        <div className="space-y-6">
          <h1 className="font-bold text-2xl tracking-tight">{photo.name}</h1>

          {objectUrl && (
            <div className="overflow-hidden rounded-lg border bg-muted">
              <img
                src={objectUrl}
                alt={photo.name}
                className="mx-auto max-h-[70vh] object-contain"
              />
            </div>
          )}

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Photo Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileType className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Type</span>
                <span className="ml-auto font-mono text-sm">
                  {photo.mimeType}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Size</span>
                <span className="ml-auto font-mono text-sm">
                  {formatFileSize(photo.size)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Uploaded</span>
                <span className="ml-auto text-sm">
                  {formatDate(photo.uploadDate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
