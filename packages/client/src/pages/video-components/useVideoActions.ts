/**
 * Hook for video action handlers.
 */

import { eq } from 'drizzle-orm';
import { useCallback } from 'react';
import { getDatabase } from '@/db';
import { files } from '@/db/schema';
import { useNavigateWithFrom } from '@/lib/navigation';
import type { VideoOpenOptions, VideoWithThumbnail } from './types';

interface UseVideoActionsResult {
  handleNavigateToDetail: (videoId: string, options?: VideoOpenOptions) => void;
  handlePlay: (video: VideoWithThumbnail) => void;
  handleGetInfo: (video: VideoWithThumbnail) => void;
  handleDelete: (videoToDelete: VideoWithThumbnail) => Promise<void>;
}

export function useVideoActions(
  setVideos: React.Dispatch<React.SetStateAction<VideoWithThumbnail[]>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  onOpenVideo?:
    | ((videoId: string, options?: VideoOpenOptions) => void)
    | undefined
): UseVideoActionsResult {
  const navigateWithFrom = useNavigateWithFrom();

  const handleNavigateToDetail = useCallback(
    (videoId: string, options?: VideoOpenOptions) => {
      if (onOpenVideo) {
        onOpenVideo(videoId, options);
        return;
      }
      const navigationOptions: {
        fromLabel: string;
        state?: Record<string, unknown>;
      } = { fromLabel: 'Back to Videos' };
      if (options?.autoPlay) {
        navigationOptions.state = { autoPlay: true };
      }
      navigateWithFrom(`/videos/${videoId}`, navigationOptions);
    },
    [navigateWithFrom, onOpenVideo]
  );

  const handlePlay = useCallback(
    (video: VideoWithThumbnail) => {
      handleNavigateToDetail(video.id, { autoPlay: true });
    },
    [handleNavigateToDetail]
  );

  const handleGetInfo = useCallback(
    (video: VideoWithThumbnail) => {
      handleNavigateToDetail(video.id);
    },
    [handleNavigateToDetail]
  );

  const handleDelete = useCallback(
    async (videoToDelete: VideoWithThumbnail) => {
      try {
        const db = getDatabase();

        // Soft delete
        await db
          .update(files)
          .set({ deleted: true })
          .where(eq(files.id, videoToDelete.id));

        // Remove from list and revoke thumbnail URL
        setVideos((prev) => {
          const remaining = prev.filter((v) => v.id !== videoToDelete.id);
          // Revoke the deleted video's thumbnail URL
          if (videoToDelete.thumbnailUrl) {
            URL.revokeObjectURL(videoToDelete.thumbnailUrl);
          }
          return remaining;
        });
      } catch (err) {
        console.error('Failed to delete video:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setVideos, setError]
  );

  return {
    handleNavigateToDetail,
    handlePlay,
    handleGetInfo,
    handleDelete
  };
}
