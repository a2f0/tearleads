/**
 * Hook for handling video file uploads.
 */

import { useCallback, useState } from 'react';
import { useFileUpload } from '@/hooks/vfs';
import { VIDEO_MIME_TYPES } from './types';

interface UseVideoUploadResult {
  uploading: boolean;
  uploadProgress: number;
  handleFilesSelected: (selectedFiles: File[]) => Promise<void>;
}

export function useVideoUpload(
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>
): UseVideoUploadResult {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        for (const file of selectedFiles) {
          // Validate that the file type is one of the supported video MIME types
          if (!VIDEO_MIME_TYPES.includes(file.type)) {
            throw new Error(
              `"${file.name}" has an unsupported video format. Supported formats: MP4, WebM, OGG, MOV, AVI, MKV, MPEG, 3GP.`
            );
          }

          await uploadFile(file, setUploadProgress);
        }

        // Refresh videos after successful upload
        setHasFetched(false);
      } catch (err) {
        console.error('Failed to upload file:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [uploadFile, setError, setHasFetched]
  );

  return {
    uploading,
    uploadProgress,
    handleFilesSelected
  };
}
