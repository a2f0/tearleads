import { useCallback, useState } from 'react';

type UploadProgressCallback = (progress: number) => void;

export interface UploadError {
  fileName: string;
  message: string;
}

interface UseMultiFileUploadOptions<TResult> {
  uploadFile: (
    file: File,
    onProgress: UploadProgressCallback
  ) => Promise<TResult>;
  validateFile?: ((file: File) => string | null) | undefined;
}

interface UploadManyResult<TResult> {
  results: TResult[];
  errors: UploadError[];
}

export function useMultiFileUpload<TResult>({
  uploadFile,
  validateFile
}: UseMultiFileUploadOptions<TResult>) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadMany = useCallback(
    async (files: File[]): Promise<UploadManyResult<TResult>> => {
      if (files.length === 0) {
        return { results: [], errors: [] };
      }

      const results: TResult[] = [];
      const errors: UploadError[] = [];
      const progresses = Array<number>(files.length).fill(0);
      const updateOverallProgress = () => {
        const total = progresses.reduce((sum, progress) => sum + progress, 0);
        setUploadProgress(Math.round(total / files.length));
      };

      setUploading(true);
      setUploadProgress(0);

      try {
        await Promise.all(
          files.map(async (file, index) => {
            const validationMessage = validateFile?.(file);
            if (validationMessage) {
              errors.push({ fileName: file.name, message: validationMessage });
              return;
            }

            try {
              const result = await uploadFile(file, (progress) => {
                progresses[index] = progress;
                updateOverallProgress();
              });
              results.push(result);
            } catch (error) {
              errors.push({
                fileName: file.name,
                message: error instanceof Error ? error.message : String(error)
              });
            }
          })
        );
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }

      return { results, errors };
    },
    [uploadFile, validateFile]
  );

  return {
    uploading,
    uploadProgress,
    uploadMany
  };
}
