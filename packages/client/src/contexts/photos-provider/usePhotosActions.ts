/**
 * Hook for photos file and window actions.
 */

import { useCallback } from 'react';
import {
  useWindowManagerActions,
  type WindowOpenRequestPayloads,
  type WindowType
} from '@/contexts/WindowManagerContext';
import { useFileUpload } from '@/hooks/vfs';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import { setAttachedImage } from '@/lib/llmRuntime';
import { logStore } from '@/stores/logStore';

interface UsePhotosActionsResult {
  uploadFile: (
    file: File,
    onProgress?: (progress: number) => void
  ) => Promise<string>;
  handleDownloadFile: (data: Uint8Array, filename: string) => void;
  handleShareFile: (
    data: Uint8Array,
    filename: string,
    mimeType: string
  ) => Promise<boolean>;
  canShareFiles: () => boolean;
  handleOpenWindow: (windowType: string) => void;
  handleRequestWindowOpen: (
    windowType: string,
    payload: Record<string, unknown>
  ) => void;
  logError: (message: string, details?: string) => void;
  logWarn: (message: string, details?: string) => void;
  handleSetAttachedImage: (dataUrl: string) => void;
}

export function usePhotosActions(): UsePhotosActionsResult {
  const { uploadFile: fileUpload } = useFileUpload();
  const { openWindow, requestWindowOpen } = useWindowManagerActions();

  const uploadFile = useCallback(
    async (
      file: File,
      onProgress?: (progress: number) => void
    ): Promise<string> => {
      const result = await fileUpload(file, onProgress);
      return result.id;
    },
    [fileUpload]
  );

  const handleDownloadFile = useCallback(
    (data: Uint8Array, filename: string): void => {
      downloadFile(data, filename);
    },
    []
  );

  const handleShareFile = useCallback(
    async (
      data: Uint8Array,
      filename: string,
      mimeType: string
    ): Promise<boolean> => {
      return shareFile(data, filename, mimeType);
    },
    []
  );

  const handleOpenWindow = useCallback(
    (windowType: string): void => {
      openWindow(windowType as WindowType);
    },
    [openWindow]
  );

  const handleRequestWindowOpen = useCallback(
    (windowType: string, payload: Record<string, unknown>): void => {
      requestWindowOpen(
        windowType as keyof WindowOpenRequestPayloads,
        payload as WindowOpenRequestPayloads[keyof WindowOpenRequestPayloads]
      );
    },
    [requestWindowOpen]
  );

  const logError = useCallback(
    (message: string, details?: string) => logStore.error(message, details),
    []
  );

  const logWarn = useCallback(
    (message: string, details?: string) => logStore.warn(message, details),
    []
  );

  const handleSetAttachedImage = useCallback((dataUrl: string): void => {
    setAttachedImage(dataUrl);
  }, []);

  return {
    uploadFile,
    handleDownloadFile,
    handleShareFile,
    canShareFiles,
    handleOpenWindow,
    handleRequestWindowOpen,
    logError,
    logWarn,
    handleSetAttachedImage
  };
}
