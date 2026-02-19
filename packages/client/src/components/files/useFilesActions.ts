/**
 * Hook for file action handlers (view, download, delete, restore, play).
 */

import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useRef } from 'react';
import { useAudio } from '@/audio';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { files as filesTable } from '@/db/schema';
import { retrieveFileData } from '@/lib/dataRetrieval';
import { downloadFile } from '@/lib/fileUtils';
import { useNavigateWithFrom } from '@/lib/navigation';
import type { FileInfo, FileWithThumbnail } from './types';

interface UseFilesActionsOptions {
  onSelectFile?: ((fileId: string) => void) | undefined;
  setFiles: React.Dispatch<React.SetStateAction<FileWithThumbnail[]>>;
  setError: (error: string | null) => void;
}

interface UseFilesActionsReturn {
  handleView: (file: FileInfo) => void;
  handleDownload: (file: FileInfo) => Promise<void>;
  handleDelete: (file: FileInfo) => Promise<void>;
  handleRestore: (file: FileInfo) => Promise<void>;
  handlePlayPause: (file: FileWithThumbnail) => Promise<void>;
  currentTrackId: string | undefined;
  isPlaying: boolean;
}

export function useFilesActions({
  onSelectFile,
  setFiles,
  setError
}: UseFilesActionsOptions): UseFilesActionsReturn {
  const navigateWithFrom = useNavigateWithFrom();
  const { currentInstanceId } = useDatabaseContext();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const audioObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
    };
  }, []);

  const handleView = useCallback(
    (file: FileInfo) => {
      if (onSelectFile) {
        onSelectFile(file.id);
        return;
      }

      const fileType = file.mimeType.split('/')[0] ?? '';
      const routeMapping: Record<string, string> = {
        image: '/photos',
        audio: '/audio',
        video: '/videos'
      };

      if (file.mimeType === 'application/pdf') {
        navigateWithFrom(`/documents/${file.id}`, {
          fromLabel: 'Back to Files'
        });
        return;
      }

      const basePath = routeMapping[fileType];
      if (basePath) {
        navigateWithFrom(`${basePath}/${file.id}`, {
          fromLabel: 'Back to Files'
        });
      }
    },
    [navigateWithFrom, onSelectFile]
  );

  const handleDownload = useCallback(
    async (file: FileInfo) => {
      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          file.storagePath,
          currentInstanceId
        );
        downloadFile(data, file.name);
      } catch (err) {
        console.error('Failed to download file:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId, setError]
  );

  const handleDelete = useCallback(
    async (file: FileInfo) => {
      try {
        const db = getDatabase();
        await db
          .update(filesTable)
          .set({ deleted: true })
          .where(eq(filesTable.id, file.id));

        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, deleted: true } : f))
        );
      } catch (err) {
        console.error('Failed to delete file:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setFiles, setError]
  );

  const handleRestore = useCallback(
    async (file: FileInfo) => {
      try {
        const db = getDatabase();
        await db
          .update(filesTable)
          .set({ deleted: false })
          .where(eq(filesTable.id, file.id));

        setFiles((prev) =>
          prev.map((f) => (f.id === file.id ? { ...f, deleted: false } : f))
        );
      } catch (err) {
        console.error('Failed to restore file:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setFiles, setError]
  );

  const handlePlayPause = useCallback(
    async (file: FileWithThumbnail) => {
      if (!currentInstanceId) return;

      if (currentTrack?.id === file.id) {
        if (isPlaying) {
          pause();
        } else {
          resume();
        }
      } else {
        try {
          const data = await retrieveFileData(
            file.storagePath,
            currentInstanceId
          );
          const blob = new Blob([new Uint8Array(data)], {
            type: file.mimeType
          });
          if (audioObjectUrlRef.current) {
            URL.revokeObjectURL(audioObjectUrlRef.current);
          }
          const objectUrl = URL.createObjectURL(blob);
          audioObjectUrlRef.current = objectUrl;
          play({
            id: file.id,
            name: file.name,
            objectUrl,
            mimeType: file.mimeType
          });
        } catch (err) {
          console.error('Failed to load audio:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [
      currentInstanceId,
      currentTrack?.id,
      isPlaying,
      pause,
      resume,
      play,
      setError
    ]
  );

  return {
    handleView,
    handleDownload,
    handleDelete,
    handleRestore,
    handlePlayPause,
    currentTrackId: currentTrack?.id,
    isPlaying
  };
}
