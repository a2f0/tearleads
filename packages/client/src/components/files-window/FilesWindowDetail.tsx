import { assertPlainArrayBuffer } from '@rapid/shared';
import { and, eq, like, or } from 'drizzle-orm';
import {
  ArrowLeft,
  Calendar,
  Download,
  FileText,
  FileType,
  Film,
  HardDrive,
  Loader2,
  Music,
  Pause,
  Play,
  Share2,
  Trash2
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { useAudio } from '@/audio';
import { DeleteFileDialog } from '@/components/DeleteFileDialog';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatDate, formatFileSize } from '@/lib/utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

const PdfViewer = lazy(() =>
  import('@/components/pdf').then((m) => ({ default: m.PdfViewer }))
);

interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
}

interface FilesWindowDetailProps {
  fileId: string;
  onBack: () => void;
  onDeleted: () => void;
}

type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'unknown';

function getFileCategory(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/'))
    return 'document';
  return 'unknown';
}

export function FilesWindowDetail({
  fileId,
  onBack,
  onDeleted
}: FilesWindowDetailProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [file, setFile] = useState<FileInfo | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [documentData, setDocumentData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    'download' | 'share' | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const urlsToRevoke = useRef<string[]>([]);
  const fileDataRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const retrieveData = useCallback(
    async (fileToRetrieve: FileInfo) => {
      const db = getDatabase();
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      return storage.measureRetrieve(
        fileToRetrieve.storagePath,
        createRetrieveLogger(db)
      );
    },
    [currentInstanceId]
  );

  const handleDownload = useCallback(async () => {
    if (!file) return;

    setActionLoading('download');
    try {
      const data = fileDataRef.current ?? (await retrieveData(file));
      downloadFile(data, file.name);
    } catch (err) {
      console.error('Failed to download file:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [file, retrieveData]);

  const handleShare = useCallback(async () => {
    if (!file) return;

    setActionLoading('share');
    try {
      const data = fileDataRef.current ?? (await retrieveData(file));
      const shared = await shareFile(data, file.name, file.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share file:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [file, retrieveData]);

  const handlePlayPause = useCallback(() => {
    if (!file || !objectUrl) return;

    if (currentTrack?.id === file.id) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      play({
        id: file.id,
        name: file.name,
        objectUrl,
        mimeType: file.mimeType
      });
    }
  }, [file, objectUrl, currentTrack?.id, isPlaying, play, pause, resume]);

  const handleDelete = useCallback(async () => {
    if (!file) return;

    const db = getDatabase();
    await db.update(files).set({ deleted: true }).where(eq(files.id, file.id));
    onDeleted();
  }, [file, onDeleted]);

  const fetchFile = useCallback(async () => {
    if (!isUnlocked || !fileId) return;

    setLoading(true);
    setError(null);
    setObjectUrl(null);
    setTextContent(null);
    setDocumentData(null);

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
            eq(files.id, fileId),
            eq(files.deleted, false),
            or(
              like(files.mimeType, 'image/%'),
              like(files.mimeType, 'video/%'),
              like(files.mimeType, 'audio/%'),
              eq(files.mimeType, 'application/pdf'),
              like(files.mimeType, 'text/%')
            )
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('File not found');
        return;
      }

      const fileInfo: FileInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath
      };
      setFile(fileInfo);

      const data = await retrieveData(fileInfo);
      assertPlainArrayBuffer(data);
      fileDataRef.current = data;

      const category = getFileCategory(fileInfo.mimeType);

      if (
        category === 'image' ||
        category === 'video' ||
        category === 'audio'
      ) {
        const blob = new Blob([data], { type: fileInfo.mimeType });
        const url = URL.createObjectURL(blob);
        urlsToRevoke.current.push(url);
        setObjectUrl(url);
      } else if (fileInfo.mimeType === 'application/pdf') {
        setDocumentData(data);
      } else if (fileInfo.mimeType.startsWith('text/')) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        setTextContent(decoder.decode(data));
      }
    } catch (err) {
      console.error('Failed to fetch file:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, fileId, retrieveData]);

  useEffect(() => {
    if (isUnlocked && fileId) {
      fetchFile();
    }

    return () => {
      for (const url of urlsToRevoke.current) {
        URL.revokeObjectURL(url);
      }
      urlsToRevoke.current = [];
      fileDataRef.current = null;
    };
  }, [isUnlocked, fileId, fetchFile]);

  const category = file ? getFileCategory(file.mimeType) : 'unknown';
  const isCurrentlyPlaying = currentTrack?.id === file?.id && isPlaying;

  return (
    <div className="flex h-full flex-col space-y-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 px-2"
          data-testid="window-file-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {file && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={actionLoading !== null}
            className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
            data-testid="window-file-delete"
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

      {!isLoading && !isUnlocked && <InlineUnlock description="this file" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading file...
        </div>
      )}

      {isUnlocked && !loading && !error && file && (
        <div className="flex min-h-0 flex-1 flex-col space-y-3">
          <h2 className="truncate font-semibold text-sm">{file.name}</h2>

          {category === 'image' && objectUrl && (
            <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
              <img
                src={objectUrl}
                alt={file.name}
                className="mx-auto max-h-48 object-contain"
                data-testid="file-detail-image"
              />
            </div>
          )}

          {category === 'video' && objectUrl && (
            <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted p-2">
              <video
                src={objectUrl}
                controls
                playsInline
                className="mx-auto max-h-48 w-full rounded"
                data-testid="file-detail-video"
              >
                <track kind="captions" />
              </video>
            </div>
          )}

          {category === 'audio' && objectUrl && (
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted p-4">
              <Music className="h-12 w-12 text-muted-foreground" />
              <Button
                variant="outline"
                size="sm"
                onClick={handlePlayPause}
                data-testid="file-detail-audio-play"
              >
                {isCurrentlyPlaying ? (
                  <>
                    <Pause className="mr-1 h-3 w-3" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-3 w-3" />
                    Play
                  </>
                )}
              </Button>
            </div>
          )}

          {category === 'document' &&
            file.mimeType === 'application/pdf' &&
            documentData && (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted p-8 text-muted-foreground text-xs">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading viewer...
                  </div>
                }
              >
                <div
                  className="max-h-64 overflow-auto rounded-lg border"
                  data-testid="file-detail-pdf"
                >
                  <PdfViewer data={documentData} />
                </div>
              </Suspense>
            )}

          {category === 'document' &&
            file.mimeType.startsWith('text/') &&
            textContent !== null && (
              <div
                className="max-h-48 overflow-auto rounded-lg border bg-muted p-2"
                data-testid="file-detail-text"
              >
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {textContent}
                </pre>
              </div>
            )}

          {category === 'unknown' && (
            <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted p-4">
              <FileText className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-xs">
                Preview not available
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={actionLoading !== null}
              data-testid="window-file-download"
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
                data-testid="window-file-share"
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
                {category === 'image' && (
                  <FileType className="h-3 w-3 text-muted-foreground" />
                )}
                {category === 'video' && (
                  <Film className="h-3 w-3 text-muted-foreground" />
                )}
                {category === 'audio' && (
                  <Music className="h-3 w-3 text-muted-foreground" />
                )}
                {(category === 'document' || category === 'unknown') && (
                  <FileText className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">Type</span>
                <span className="ml-auto font-mono">{file.mimeType}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Size</span>
                <span className="ml-auto font-mono">
                  {formatFileSize(file.size)}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Uploaded</span>
                <span className="ml-auto">{formatDate(file.uploadDate)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {file && (
        <DeleteFileDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          fileName={file.name}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
