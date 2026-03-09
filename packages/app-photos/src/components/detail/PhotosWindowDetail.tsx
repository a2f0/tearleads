import {
  ArrowLeft,
  Calendar,
  Download,
  FileType,
  HardDrive,
  Loader2,
  Share2,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type PhotoWithUrl, usePhotosUIContext } from '../../context';

export interface PhotosWindowDetailProps {
  photoId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function PhotosWindowDetail({
  photoId,
  onBack,
  onDeleted
}: PhotosWindowDetailProps) {
  const {
    ui,
    databaseState,
    fetchPhotoById,
    softDeletePhoto,
    downloadPhotoData,
    sharePhotoData,
    downloadFile,
    shareFile,
    canShareFiles,
    formatFileSize,
    formatDate,
    logError
  } = usePhotosUIContext();

  const {
    Button,
    InlineUnlock,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
  } = ui;
  const { isUnlocked, isLoading } = databaseState;

  const [photo, setPhoto] = useState<PhotoWithUrl | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const urlsToRevoke = useRef<string[]>([]);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, [canShareFiles]);

  const handleDownload = useCallback(async () => {
    if (!photo) return;

    setActionLoading('download');
    try {
      const data = await downloadPhotoData(photo);
      downloadFile(data, photo.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('Failed to download photo', message);
      setError(message);
    } finally {
      setActionLoading(null);
    }
  }, [photo, downloadPhotoData, downloadFile, logError]);

  const handleShare = useCallback(async () => {
    if (!photo) return;

    setActionLoading('share');
    try {
      const data = await sharePhotoData(photo);
      const shared = await shareFile(data, photo.name, photo.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logError('Failed to share photo', message);
      setError(message);
    } finally {
      setActionLoading(null);
    }
  }, [photo, sharePhotoData, shareFile, logError]);

  const handleDelete = useCallback(async () => {
    if (!photo) return;

    setIsDeleting(true);
    try {
      await softDeletePhoto(photo.id);
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('Failed to delete photo', message);
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }, [photo, softDeletePhoto, onDeleted, logError]);

  const fetchPhoto = useCallback(async () => {
    if (!isUnlocked || !photoId) return;

    setLoading(true);
    setError(null);

    try {
      const foundPhoto = await fetchPhotoById(photoId);

      if (!foundPhoto) {
        setError('Photo not found');
        return;
      }

      // Track URL for cleanup
      if (foundPhoto.objectUrl) {
        urlsToRevoke.current.push(foundPhoto.objectUrl);
      }

      setPhoto(foundPhoto);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('Failed to fetch photo', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, photoId, fetchPhotoById, logError]);

  useEffect(() => {
    if (isUnlocked && photoId) {
      void fetchPhoto();
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

          {photo.objectUrl && (
            <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
              <img
                src={photo.objectUrl}
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
          </div>

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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Photo</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{photo?.name}"? This action can
              be undone from the trash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
