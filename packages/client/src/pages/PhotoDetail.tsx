import { and, eq, like } from 'drizzle-orm';
import {
  ArrowLeft,
  Calendar,
  Database,
  Download,
  FileType,
  HardDrive,
  Loader2,
  Share2
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatDate, formatFileSize } from '@/lib/utils';
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

export function PhotoDetail() {
  const { id } = useParams<{ id: string }>();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | null
  >(null);

  // Check if Web Share API is available on mount
  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(async () => {
    if (!photo) return;

    setActionLoading('download');
    try {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(photo.storagePath);
      downloadFile(data, photo.name);
    } catch (err) {
      console.error('Failed to download photo:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [photo, currentInstanceId]);

  const handleShare = useCallback(async () => {
    if (!photo) return;

    setActionLoading('share');
    try {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(photo.storagePath);
      const shared = await shareFile(data, photo.name, photo.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      // User cancelled share - don't show error
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share photo:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [photo, currentInstanceId]);

  const fetchPhoto = useCallback(async () => {
    if (!isUnlocked || !id) return;

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
          storagePath: files.storagePath
        })
        .from(files)
        .where(
          and(
            eq(files.id, id),
            like(files.mimeType, 'image/%'),
            eq(files.deleted, false)
          )
        )
        .limit(1);

      if (result.length === 0) {
        setError('Photo not found');
        return;
      }

      const row = result[0];
      if (!row) {
        setError('Photo not found');
        return;
      }

      const photoInfo: PhotoInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath
      };
      setPhoto(photoInfo);

      // Load image data and create object URL
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
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
  }, [isUnlocked, id, currentInstanceId]);

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

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleDownload}
              disabled={actionLoading !== null}
              data-testid="download-button"
            >
              {actionLoading === 'download' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download
            </Button>
            {canShare && (
              <Button
                variant="outline"
                onClick={handleShare}
                disabled={actionLoading !== null}
                data-testid="share-button"
              >
                {actionLoading === 'share' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-2 h-4 w-4" />
                )}
                Share
              </Button>
            )}
          </div>

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
