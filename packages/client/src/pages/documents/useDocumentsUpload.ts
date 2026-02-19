/**
 * Hook for handling document file uploads.
 */

import { useCallback, useState } from 'react';
import { useFileUpload } from '@/hooks/useFileUpload';

const PDF_MIME_TYPE = 'application/pdf';

interface UseDocumentsUploadResult {
  uploading: boolean;
  uploadProgress: number;
  handleFilesSelected: (selectedFiles: File[]) => Promise<void>;
}

export function useDocumentsUpload(
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>
): UseDocumentsUploadResult {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      const isDocumentType = (type: string) =>
        type === PDF_MIME_TYPE || type.startsWith('text/');
      const validFiles = selectedFiles.filter((file) =>
        isDocumentType(file.type)
      );
      const invalidFileErrors = selectedFiles
        .filter((file) => !isDocumentType(file.type))
        .map((file) => `"${file.name}" is not a supported document type.`);

      const errors: string[] = [...invalidFileErrors];
      const progresses = Array(validFiles.length).fill(0);
      let uploadedCount = 0;

      const updateOverallProgress = () => {
        if (validFiles.length === 0) return;
        const totalProgress = progresses.reduce((sum, p) => sum + p, 0);
        setUploadProgress(Math.round(totalProgress / validFiles.length));
      };

      const uploadPromises = validFiles.map(async (file, index) => {
        try {
          await uploadFile(file, (progress) => {
            progresses[index] = progress;
            updateOverallProgress();
          });
          uploadedCount++;
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
          errors.push(
            `"${file.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      });

      await Promise.all(uploadPromises);

      if (uploadedCount > 0) {
        setHasFetched(false);
      }

      if (errors.length > 0) {
        setError(errors.join('\n'));
      }

      setUploading(false);
      setUploadProgress(0);
    },
    [uploadFile, setError, setHasFetched]
  );

  return {
    uploading,
    uploadProgress,
    handleFilesSelected
  };
}
