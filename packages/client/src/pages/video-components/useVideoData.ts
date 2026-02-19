/**
 * Hook for fetching and managing video data.
 */

import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files, vfsLinks } from '@/db/schema';
import {
  createRetrieveLogger,
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import type { VideoInfo, VideoWithThumbnail } from './types';

interface UseVideoDataResult {
  videos: VideoWithThumbnail[];
  setVideos: React.Dispatch<React.SetStateAction<VideoWithThumbnail[]>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  fetchVideos: () => Promise<void>;
}

export function useVideoData(
  playlistId: string | null | undefined
): UseVideoDataResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [videos, setVideos] = useState<VideoWithThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  // Track the instance ID for which we've fetched videos
  const fetchedForInstanceRef = useRef<string | null>(null);
  const fetchedForPlaylistRef = useRef<string | null | undefined>(undefined);

  const fetchVideos = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // If a playlist is selected, get the video IDs in that playlist
      let videoIdsInPlaylist: string[] | null = null;
      if (playlistId) {
        const links = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, playlistId));
        videoIdsInPlaylist = links.map((link) => link.childId);

        // If playlist is empty, return early
        if (videoIdsInPlaylist.length === 0) {
          setVideos([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      const baseConditions = and(
        like(files.mimeType, 'video/%'),
        eq(files.deleted, false)
      );
      const whereClause = videoIdsInPlaylist
        ? and(baseConditions, inArray(files.id, videoIdsInPlaylist))
        : baseConditions;

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath
        })
        .from(files)
        .where(whereClause)
        .orderBy(desc(files.uploadDate));

      const videoList: VideoInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      // Load video data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      // Only load thumbnails, not full video data - video content is loaded on demand in VideoDetail
      const videosWithThumbnails = await Promise.all(
        videoList.map(async (video) => {
          let thumbnailUrl: string | null = null;
          if (video.thumbnailPath) {
            try {
              const thumbData = await storage.measureRetrieve(
                video.thumbnailPath,
                logger
              );
              assertPlainArrayBuffer(thumbData);
              const thumbBlob = new Blob([thumbData], {
                type: 'image/jpeg'
              });
              thumbnailUrl = URL.createObjectURL(thumbBlob);
            } catch (err) {
              console.warn(`Failed to load thumbnail for ${video.name}:`, err);
            }
          }
          return { ...video, thumbnailUrl };
        })
      );

      setVideos(videosWithThumbnails);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch videos:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, playlistId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: videos intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance or playlist
    const instanceChanged = fetchedForInstanceRef.current !== currentInstanceId;
    const playlistChanged = fetchedForPlaylistRef.current !== playlistId;
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || instanceChanged || playlistChanged);

    if (needsFetch) {
      // If instance or playlist changed, cleanup old thumbnail URLs first
      if (
        (instanceChanged || playlistChanged) &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const video of videos) {
          if (video.thumbnailUrl) {
            URL.revokeObjectURL(video.thumbnailUrl);
          }
        }
        setVideos([]);
        setError(null);
      }

      // Update refs before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;
      fetchedForPlaylistRef.current = playlistId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchVideos();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    playlistId,
    fetchVideos
  ]);

  // Cleanup thumbnail URLs on unmount
  useEffect(() => {
    return () => {
      for (const v of videos) {
        if (v.thumbnailUrl) {
          URL.revokeObjectURL(v.thumbnailUrl);
        }
      }
    };
  }, [videos]);

  return {
    videos,
    setVideos,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchVideos
  };
}
