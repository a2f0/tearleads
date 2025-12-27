import { CheckCircle, FileIcon, Loader2, XCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Dropzone } from '@/components/ui/dropzone';
import { useDatabaseContext } from '@/db/hooks';
import { useFileUpload } from '@/hooks/useFileUpload';
import { formatFileSize } from '@/lib/utils';

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'duplicate' | 'error';
  error?: string;
}

export function Home() {
  const { isUnlocked } = useDatabaseContext();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const { uploadFile } = useFileUpload();

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (!isUnlocked) {
        return;
      }

      // Add files to upload queue with unique IDs
      const newFiles: UploadingFile[] = files.map((file) => ({
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
    },
    [isUnlocked, uploadFile]
  );

  const clearCompleted = useCallback(() => {
    setUploadingFiles((prev) =>
      prev.filter((f) => f.status !== 'complete' && f.status !== 'duplicate')
    );
  }, []);

  const hasCompleted = uploadingFiles.some(
    (f) => f.status === 'complete' || f.status === 'duplicate'
  );

  return (
    <div className="space-y-4">
      <Dropzone
        onFilesSelected={handleFilesSelected}
        className="mb-8"
        disabled={!isUnlocked}
      />

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
    </div>
  );
}
