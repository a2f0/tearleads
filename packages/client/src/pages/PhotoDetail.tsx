import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, eq, like } from 'drizzle-orm';
import {
  Calendar,
  Download,
  FileType,
  HardDrive,
  Loader2,
  ScanSearch,
  Share2,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeletePhotoDialog } from '@/components/DeletePhotoDialog';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { type ClassificationResult, useLLM } from '@/hooks/useLLM';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { CLASSIFICATION_MODEL, DOCUMENT_LABELS } from '@/lib/models';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
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
  const navigate = useNavigate();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const {
    loadedModel,
    isClassifying,
    loadModel,
    classify,
    isLoading: isModelLoading,
    loadProgress
  } = useLLM();
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | null
  >(null);
  const [classificationResult, setClassificationResult] =
    useState<ClassificationResult | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Track all created blob URLs to revoke on unmount.
  // We don't revoke on objectUrl changes because the browser may still be
  // loading the image asynchronously, causing display issues.
  const urlsToRevoke = useRef<string[]>([]);

  // Check if Web Share API is available on mount
  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(async () => {
    if (!photo) return;

    setActionLoading('download');
    try {
      const db = getDatabase();
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const data = await storage.measureRetrieve(
        photo.storagePath,
        createRetrieveLogger(db)
      );
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
      const db = getDatabase();
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const data = await storage.measureRetrieve(
        photo.storagePath,
        createRetrieveLogger(db)
      );
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

  const handleClassify = useCallback(async () => {
    if (!objectUrl) return;

    setError(null);
    setClassificationResult(null);

    try {
      // Load CLIP model if not already loaded
      if (loadedModel !== CLASSIFICATION_MODEL.id) {
        await loadModel(CLASSIFICATION_MODEL.id);
      }

      // Run classification
      const result = await classify(objectUrl, DOCUMENT_LABELS);
      setClassificationResult(result);
    } catch (err) {
      console.error('Failed to classify photo:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [objectUrl, loadedModel, loadModel, classify]);

  const handleDelete = useCallback(async () => {
    if (!photo) return;

    const db = getDatabase();
    await db.update(files).set({ deleted: true }).where(eq(files.id, photo.id));
    navigate('/photos');
  }, [photo, navigate]);

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
      const data = await storage.measureRetrieve(
        photoInfo.storagePath,
        createRetrieveLogger(db)
      );
      assertPlainArrayBuffer(data);
      const blob = new Blob([data], { type: photoInfo.mimeType });
      const url = URL.createObjectURL(blob);
      urlsToRevoke.current.push(url);
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

  // Only revoke URLs on unmount, not on objectUrl changes
  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/photos" defaultLabel="Back to Photos" />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="this photo" />}

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
            <Button
              variant="outline"
              onClick={handleClassify}
              disabled={
                actionLoading !== null || isModelLoading || isClassifying
              }
              data-testid="classify-button"
            >
              {isModelLoading || isClassifying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="mr-2 h-4 w-4" />
              )}
              {isModelLoading
                ? `Loading${loadProgress ? ` ${Math.round(loadProgress.progress * 100)}%` : '...'}`
                : isClassifying
                  ? 'Classifying...'
                  : 'Classify Document'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={actionLoading !== null}
              data-testid="delete-button"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>

          {classificationResult && (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Document Classification</h2>
              </div>
              <div className="divide-y">
                {classificationResult.labels
                  .map((label, index) => ({
                    label,
                    score: classificationResult.scores[index] ?? 0
                  }))
                  .sort((a, b) => b.score - a.score)
                  .map(({ label, score }) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="text-sm capitalize">{label}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${score * 100}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono text-muted-foreground text-sm">
                          {(score * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
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

      {photo && (
        <DeletePhotoDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          photoName={photo.name}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
