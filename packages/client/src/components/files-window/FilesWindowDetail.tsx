import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, eq, like, or } from 'drizzle-orm';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '@/audio';
import { DeleteFileDialog } from '@/components/DeleteFileDialog';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { FileDetailActions } from './FileDetailActions';
import { FileDetailHeader } from './FileDetailHeader';
import { FileDetailInfoPanel } from './FileDetailInfoPanel';
import { FileDetailPreview } from './FileDetailPreview';
import { type FileInfo, getFileCategory } from './fileDetailTypes';

interface FilesWindowDetailProps {
  fileId: string;
  onBack: () => void;
  onDeleted: () => void;
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
      <FileDetailHeader
        canDelete={Boolean(file)}
        onBack={onBack}
        onDeleteRequest={() => setDeleteDialogOpen(true)}
        actionsDisabled={actionLoading !== null}
      />

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
          <FileDetailPreview
            category={category}
            documentData={documentData}
            file={file}
            isCurrentlyPlaying={isCurrentlyPlaying}
            objectUrl={objectUrl}
            onPlayPause={handlePlayPause}
            textContent={textContent}
          />
          <FileDetailActions
            actionLoading={actionLoading}
            canShare={canShare}
            onDownload={handleDownload}
            onShare={handleShare}
          />
          <FileDetailInfoPanel category={category} file={file} />
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
