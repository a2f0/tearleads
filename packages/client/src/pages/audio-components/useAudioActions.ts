/**
 * Hook for audio track actions (play, delete, context menu).
 */

import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useAudio } from '@/audio';
import { getDatabase } from '@/db';
import { files } from '@/db/schema';
import { useNavigateWithFrom } from '@/lib/navigation';
import type { AudioWithUrl } from './types';

interface ContextMenuState {
  track: AudioWithUrl;
  x: number;
  y: number;
}

interface UseAudioActionsResult {
  contextMenu: ContextMenuState | null;
  handlePlayPause: (track: AudioWithUrl) => void;
  handleNavigateToDetail: (trackId: string) => void;
  handleContextMenu: (e: React.MouseEvent, track: AudioWithUrl) => void;
  handleCloseContextMenu: () => void;
  handleGetInfo: (track: AudioWithUrl) => void;
  handleContextMenuPlay: (track: AudioWithUrl) => void;
  handleDelete: (trackToDelete: AudioWithUrl) => Promise<void>;
}

export function useAudioActions(
  setTracks: React.Dispatch<React.SetStateAction<AudioWithUrl[]>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>
): UseAudioActionsResult {
  const navigateWithFrom = useNavigateWithFrom();
  const { currentTrack, isPlaying, play, pause, resume } = useAudio();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handlePlayPause = useCallback(
    (track: AudioWithUrl) => {
      if (currentTrack?.id === track.id) {
        if (isPlaying) {
          pause();
        } else {
          resume();
        }
      } else {
        play({
          id: track.id,
          name: track.name,
          objectUrl: track.objectUrl,
          mimeType: track.mimeType
        });
      }
    },
    [currentTrack?.id, isPlaying, pause, resume, play]
  );

  const handleNavigateToDetail = useCallback(
    (trackId: string) => {
      navigateWithFrom(`/audio/${trackId}`, {
        fromLabel: 'Back to Audio'
      });
    },
    [navigateWithFrom]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, track: AudioWithUrl) => {
      e.preventDefault();
      setContextMenu({ track, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGetInfo = useCallback(
    (track: AudioWithUrl) => {
      navigateWithFrom(`/audio/${track.id}`, {
        fromLabel: 'Back to Audio'
      });
      setContextMenu(null);
    },
    [navigateWithFrom]
  );

  const handleContextMenuPlay = useCallback(
    (track: AudioWithUrl) => {
      handlePlayPause(track);
      setContextMenu(null);
    },
    [handlePlayPause]
  );

  const handleDelete = useCallback(
    async (trackToDelete: AudioWithUrl) => {
      setContextMenu(null);

      try {
        const db = getDatabase();

        // Soft delete
        await db
          .update(files)
          .set({ deleted: true })
          .where(eq(files.id, trackToDelete.id));

        // Remove from list and revoke URLs
        setTracks((prev) => {
          const remaining = prev.filter((t) => t.id !== trackToDelete.id);
          // Revoke the deleted track's URLs
          URL.revokeObjectURL(trackToDelete.objectUrl);
          if (trackToDelete.thumbnailUrl) {
            URL.revokeObjectURL(trackToDelete.thumbnailUrl);
          }
          return remaining;
        });
      } catch (err) {
        console.error('Failed to delete track:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setTracks, setError]
  );

  return {
    contextMenu,
    handlePlayPause,
    handleNavigateToDetail,
    handleContextMenu,
    handleCloseContextMenu,
    handleGetInfo,
    handleContextMenuPlay,
    handleDelete
  };
}
