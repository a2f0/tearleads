/**
 * Hook for handling audio file uploads.
 */

import { useCallback, useState } from 'react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { AUDIO_MIME_TYPES } from './types';

interface UseAudioUploadResult {
  uploading: boolean;
  uploadProgress: number;
  handleFilesSelected: (files: File[]) => Promise<void>;
}

export function useAudioUpload(
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>
): UseAudioUploadResult {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        for (const file of files) {
          // Validate that the file type is one of the supported audio MIME types
          if (!AUDIO_MIME_TYPES.includes(file.type)) {
            throw new Error(
              `"${file.name}" has an unsupported audio format. Supported formats: MP3, WAV, OGG, FLAC, AAC, M4A, WebM, AIFF.`
            );
          }

          await uploadFile(file, setUploadProgress);
        }

        // Refresh tracks after successful upload
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
