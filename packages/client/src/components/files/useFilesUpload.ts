/**
 * Hook for file upload management in FilesList.
 */

import { useCallback, useState } from 'react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { getErrorMessage } from '@/lib/errors';
import type { UploadingFile } from './types';

interface UseFilesUploadOptions {
  isUnlocked: boolean;
  onFilesChange?: (() => void) | undefined;
  onUpload?: (() => void) | undefined;
  fetchFiles: () => Promise<void>;
}

interface UseFilesUploadReturn {
  uploadingFiles: UploadingFile[];
  recentlyUploadedIds: Set<string>;
  isUploadInProgress: boolean;
  handleFilesSelected: (selectedFiles: File[]) => Promise<void>;
  clearRecentlyUploaded: (fileId: string) => void;
}

export function useFilesUpload({
  isUnlocked,
  onFilesChange,
  fetchFiles
}: UseFilesUploadOptions): UseFilesUploadReturn {
  const { uploadFile } = useFileUpload();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [recentlyUploadedIds, setRecentlyUploadedIds] = useState<Set<string>>(
    new Set()
  );

  const isUploadInProgress = uploadingFiles.some(
    (entry) => entry.status === 'pending' || entry.status === 'uploading'
  );

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (!isUnlocked) return;

      const newFiles: UploadingFile[] = selectedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: 'pending'
      }));
      setUploadingFiles((prev) => [...prev, ...newFiles]);

      const uploadedIds: string[] = [];
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

          if (!result.isDuplicate) {
            uploadedIds.push(result.id);
          }

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
                ? { ...f, status: 'error', error: getErrorMessage(err) }
                : f
            )
          );
        }
      });

      await Promise.all(uploadPromises);

      if (uploadedIds.length > 0) {
        setRecentlyUploadedIds((prev) => new Set([...prev, ...uploadedIds]));
      }

      setUploadingFiles((prev) =>
        prev.filter((f) => f.status !== 'complete' && f.status !== 'duplicate')
      );

      fetchFiles();
      onFilesChange?.();
    },
    [isUnlocked, uploadFile, fetchFiles, onFilesChange]
  );

  const clearRecentlyUploaded = useCallback((fileId: string) => {
    setRecentlyUploadedIds((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
  }, []);

  return {
    uploadingFiles,
    recentlyUploadedIds,
    isUploadInProgress,
    handleFilesSelected,
    clearRecentlyUploaded
  };
}
