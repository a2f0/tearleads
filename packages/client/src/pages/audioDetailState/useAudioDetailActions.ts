/**
 * Hook for AudioDetail action handlers.
 */

import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudio } from '@/audio';
import type { ActionType } from '@/components/ui/ActionToolbar';
import { getDatabase } from '@/db';
import { files } from '@/db/schema';
import { canShareFiles, downloadFile, shareFile } from '@/lib/fileUtils';
import type { RetrieveMetrics } from '@/storage/opfs';
import { createRetrieveLogger } from '@/storage/opfs';
import type { AudioInfo } from './useAudioDetailData';

interface UseAudioDetailActionsOptions {
  audio: AudioInfo | null;
  objectUrl: string | null;
  retrieveFileData: (
    storagePath: string,
    onMetrics?: (metrics: RetrieveMetrics) => void | Promise<void>
  ) => Promise<Uint8Array>;
  setError: (error: string | null) => void;
  updateAudioName: (newName: string) => void;
}

export function useAudioDetailActions({
  audio,
  objectUrl,
  retrieveFileData,
  setError,
  updateAudioName
}: UseAudioDetailActionsOptions) {
  const navigate = useNavigate();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);
  const [canShare] = useState(() => canShareFiles());

  const isCurrentTrack = currentTrack?.id === audio?.id;
  const isTrackPlaying = isCurrentTrack && isPlaying;

  const handlePlayPause = useCallback(() => {
    if (!audio || !objectUrl) return;

    if (isCurrentTrack) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
    } else {
      play({
        id: audio.id,
        name: audio.name,
        objectUrl: objectUrl,
        mimeType: audio.mimeType
      });
    }
  }, [audio, objectUrl, isCurrentTrack, isPlaying, play, pause, resume]);

  const handleDownload = useCallback(async () => {
    if (!audio) return;

    setActionLoading('download');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        audio.storagePath,
        createRetrieveLogger(db)
      );
      downloadFile(data, audio.name);
    } catch (err) {
      console.error('Failed to download audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFileData, setError]);

  const handleShare = useCallback(async () => {
    if (!audio) return;

    setActionLoading('share');
    try {
      const db = getDatabase();
      const data = await retrieveFileData(
        audio.storagePath,
        createRetrieveLogger(db)
      );
      const shared = await shareFile(data, audio.name, audio.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      // User cancelled share - don't show error
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share audio:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [audio, retrieveFileData, setError]);

  const handleDelete = useCallback(async () => {
    if (!audio) return;

    setActionLoading('delete');
    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, audio.id));

      navigate('/audio');
    } catch (err) {
      console.error('Failed to delete audio:', err);
      setError(err instanceof Error ? err.message : String(err));
      setActionLoading(null);
    }
  }, [audio, navigate, setError]);

  const handleUpdateName = useCallback(
    async (newName: string) => {
      if (!audio) return;

      const db = getDatabase();
      await db
        .update(files)
        .set({ name: newName })
        .where(eq(files.id, audio.id));

      updateAudioName(newName);
    },
    [audio, updateAudioName]
  );

  return {
    currentTrack,
    isTrackPlaying,
    actionLoading,
    canShare,
    handlePlayPause,
    handleDownload,
    handleShare,
    handleDelete,
    handleUpdateName
  };
}
