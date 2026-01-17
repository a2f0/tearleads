import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, eq, like } from 'drizzle-orm';
import {
  ArrowLeft,
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
import { DeletePhotoDialog } from '@/components/DeletePhotoDialog';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
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

interface PhotosWindowDetailProps {
  photoId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function PhotosWindowDetail({
  photoId,
  onBack,
  onDeleted
}: PhotosWindowDetailProps) {
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

  const urlsToRevoke = useRef<string[]>([]);

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
      if (loadedModel !== CLASSIFICATION_MODEL.id) {
        await loadModel(CLASSIFICATION_MODEL.id);
      }
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
    onDeleted();
  }, [photo, onDeleted]);

  const fetchPhoto = useCallback(async () => {
    if (!isUnlocked || !photoId) return;

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
            eq(files.id, photoId),
            like(files.mimeType, 'image/%'),
            eq(files.deleted, false)
          )
        )
        .limit(1);

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
  }, [isUnlocked, photoId, currentInstanceId]);

  useEffect(() => {
    if (isUnlocked && photoId) {
      fetchPhoto();
    }
  }, [isUnlocked, photoId, fetchPhoto]);

  useEffect(() => {
    return () => {
      for (const url of urlsToRevoke.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 px-2"
          data-testid="window-photo-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {photo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={actionLoading !== null}
            className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
            data-testid="window-photo-delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="this photo" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading photo...
        </div>
      )}

      {isUnlocked && !loading && !error && photo && (
        <div className="flex min-h-0 flex-1 flex-col space-y-3">
          <h2 className="truncate font-semibold text-sm">{photo.name}</h2>

          {objectUrl && (
            <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
              <img
                src={objectUrl}
                alt={photo.name}
                className="mx-auto max-h-48 object-contain"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={actionLoading !== null}
              data-testid="window-photo-download"
            >
              {actionLoading === 'download' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Download className="mr-1 h-3 w-3" />
              )}
              Download
            </Button>
            {canShare && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleShare}
                disabled={actionLoading !== null}
                data-testid="window-photo-share"
              >
                {actionLoading === 'share' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Share2 className="mr-1 h-3 w-3" />
                )}
                Share
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleClassify}
              disabled={
                actionLoading !== null || isModelLoading || isClassifying
              }
              data-testid="window-photo-classify"
            >
              {isModelLoading || isClassifying ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ScanSearch className="mr-1 h-3 w-3" />
              )}
              {isModelLoading
                ? `${Math.round((loadProgress?.progress ?? 0) * 100)}%`
                : isClassifying
                  ? 'Classifying...'
                  : 'Classify'}
            </Button>
          </div>

          {classificationResult && (
            <div className="rounded-lg border text-xs">
              <div className="border-b px-3 py-2">
                <h3 className="font-semibold">Classification</h3>
              </div>
              <div className="divide-y">
                {classificationResult.labels
                  .map((label, index) => ({
                    label,
                    score: classificationResult.scores[index] ?? 0
                  }))
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 3)
                  .map(({ label, score }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <span className="capitalize">{label}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${score * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-muted-foreground">
                          {(score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border text-xs">
            <div className="border-b px-3 py-2">
              <h3 className="font-semibold">Details</h3>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-2 px-3 py-2">
                <FileType className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Type</span>
                <span className="ml-auto font-mono">{photo.mimeType}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Size</span>
                <span className="ml-auto font-mono">
                  {formatFileSize(photo.size)}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Uploaded</span>
                <span className="ml-auto">{formatDate(photo.uploadDate)}</span>
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
