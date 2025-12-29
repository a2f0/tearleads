import {
  CheckCircle,
  Database,
  Download,
  Eye,
  FileIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { getDatabaseAdapter } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { useFileUpload } from '@/hooks/useFileUpload';
import { downloadFile } from '@/lib/file-utils';
import { formatFileSize } from '@/lib/utils';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
  deleted: boolean;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'duplicate' | 'error';
  error?: string;
}

export function Files() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const { uploadFile } = useFileUpload();

  const fetchFiles = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      const result = await adapter.execute(
        `SELECT id, name, size, mime_type, upload_date, storage_path, deleted
         FROM files
         ORDER BY upload_date DESC`,
        []
      );

      const fileList = result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r['id'] as string,
          name: r['name'] as string,
          size: r['size'] as number,
          mimeType: r['mime_type'] as string,
          uploadDate: new Date(r['upload_date'] as number),
          storagePath: r['storage_path'] as string,
          deleted: Boolean(r['deleted'])
        };
      });

      setFiles(fileList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch files:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchFiles();
    }
  }, [isUnlocked, hasFetched, loading, fetchFiles]);

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (!isUnlocked) {
        return;
      }

      // Add files to upload queue with unique IDs
      const newFiles: UploadingFile[] = selectedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'pending' as const
      }));
      setUploadingFiles((prev) => [...prev, ...newFiles]);

      // Process files in parallel
      const uploadPromises = newFiles.map(async (fileEntry) => {
        try {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === fileEntry.id ? { ...f, status: 'uploading' } : f
            )
          );

          const result = await uploadFile(fileEntry.file, (progress) => {
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === fileEntry.id ? { ...f, progress } : f))
            );
          });

          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === fileEntry.id
                ? {
                    ...f,
                    status: result.isDuplicate ? 'duplicate' : 'complete',
                    progress: 100
                  }
                : f
            )
          );
        } catch (err) {
          setUploadingFiles((prev) =>
            prev.map((f) =>
              f.id === fileEntry.id
                ? { ...f, status: 'error', error: String(err) }
                : f
            )
          );
        }
      });

      await Promise.all(uploadPromises);

      // Refresh file list after uploads complete
      fetchFiles();
    },
    [isUnlocked, uploadFile, fetchFiles]
  );

  const clearCompleted = useCallback(() => {
    setUploadingFiles((prev) =>
      prev.filter((f) => f.status !== 'complete' && f.status !== 'duplicate')
    );
  }, []);

  const hasCompleted = uploadingFiles.some(
    (f) => f.status === 'complete' || f.status === 'duplicate'
  );

  const handleView = useCallback(async (file: FileInfo) => {
    try {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(file.storagePath);

      // Create blob and open in new tab (copy for TypeScript compatibility)
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      const blob = new Blob([buffer], { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Clean up after a delay to allow the tab to load
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Failed to view file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleDownload = useCallback(async (file: FileInfo) => {
    try {
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey);
      }

      const storage = getFileStorage();
      const data = await storage.retrieve(file.storagePath);

      downloadFile(data, file.name);
    } catch (err) {
      console.error('Failed to download file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleDelete = useCallback(async (file: FileInfo) => {
    try {
      const adapter = getDatabaseAdapter();

      // Soft delete
      await adapter.execute('UPDATE files SET deleted = 1 WHERE id = ?', [
        file.id
      ]);

      // Update in list
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, deleted: true } : f))
      );
    } catch (err) {
      console.error('Failed to delete file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleRestore = useCallback(async (file: FileInfo) => {
    try {
      const adapter = getDatabaseAdapter();

      await adapter.execute('UPDATE files SET deleted = 0 WHERE id = ?', [
        file.id
      ]);

      // Update in list
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, deleted: false } : f))
      );
    } catch (err) {
      console.error('Failed to restore file:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Files</h1>
        {isUnlocked && (
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <button
                type="button"
                role="switch"
                aria-checked={showDeleted}
                onClick={() => setShowDeleted(!showDeleted)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  showDeleted ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-sm transition-transform ${
                    showDeleted ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-muted-foreground">Show deleted</span>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchFiles}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        )}
      </div>

      <Dropzone onFilesSelected={handleFilesSelected} disabled={!isUnlocked} />

      {!isUnlocked && (
        <p className="text-center text-muted-foreground text-sm">
          Unlock the database to upload files
        </p>
      )}

      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {hasCompleted && (
            <button
              type="button"
              onClick={clearCompleted}
              className="text-muted-foreground text-xs hover:underline"
            >
              Clear completed
            </button>
          )}
          {uploadingFiles.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
            >
              {entry.status === 'uploading' && (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
              )}
              {entry.status === 'complete' && (
                <CheckCircle className="h-5 w-5 shrink-0 text-green-500" />
              )}
              {entry.status === 'duplicate' && (
                <CheckCircle className="h-5 w-5 shrink-0 text-yellow-500" />
              )}
              {entry.status === 'error' && (
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              {entry.status === 'pending' && (
                <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">
                  {entry.file.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatFileSize(entry.file.size)}
                  {entry.status === 'uploading' && ` · ${entry.progress}%`}
                  {entry.status === 'duplicate' && ' · Already exists'}
                  {entry.status === 'error' && ` · ${entry.error}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view files.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {isUnlocked && !error && (
        <div className="space-y-2">
          {loading || !hasFetched ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              Loading files...
            </div>
          ) : files.filter((f) => showDeleted || !f.deleted).length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              No files found. Drop or select files above to upload.
            </div>
          ) : (
            files
              .filter((f) => showDeleted || !f.deleted)
              .map((file) => (
                <div
                  key={file.id}
                  className={`flex items-center gap-3 rounded-lg border bg-muted/50 p-3 ${
                    file.deleted ? 'opacity-60' : ''
                  }`}
                >
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate font-medium text-sm ${
                        file.deleted ? 'line-through' : ''
                      }`}
                    >
                      {file.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatFileSize(file.size)} ·{' '}
                      {file.uploadDate.toLocaleDateString()}
                      {file.deleted && ' · Deleted'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {file.deleted ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRestore(file)}
                        title="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleView(file)}
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDownload(file)}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDelete(file)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
