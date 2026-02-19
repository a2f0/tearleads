/**
 * Hook for fetching and managing audio track data.
 */

import { assertPlainArrayBuffer } from '@tearleads/shared';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '@/audio';
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
import type { AudioInfo, AudioWithUrl } from './types';

interface UseAudioDataResult {
  tracks: AudioWithUrl[];
  setTracks: React.Dispatch<React.SetStateAction<AudioWithUrl[]>>;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  fetchTracks: () => Promise<void>;
}

export function useAudioData(
  playlistId: string | null | undefined
): UseAudioDataResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const { currentTrack } = useAudio();
  const currentTrackRef = useRef(currentTrack);
  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  // Track the instance ID and playlist ID for which we've fetched tracks
  const fetchedForInstanceRef = useRef<string | null>(null);
  const fetchedForPlaylistRef = useRef<string | null | undefined>(undefined);

  const fetchTracks = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // If a playlist is selected, get the track IDs in that playlist
      let trackIdsInPlaylist: string[] | null = null;
      if (playlistId) {
        const links = await db
          .select({ childId: vfsLinks.childId })
          .from(vfsLinks)
          .where(eq(vfsLinks.parentId, playlistId));
        trackIdsInPlaylist = links.map((link) => link.childId);

        // If playlist is empty, return early
        if (trackIdsInPlaylist.length === 0) {
          setTracks([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      const baseConditions = and(
        like(files.mimeType, 'audio/%'),
        eq(files.deleted, false)
      );
      const whereClause = trackIdsInPlaylist
        ? and(baseConditions, inArray(files.id, trackIdsInPlaylist))
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

      const trackList: AudioInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath
      }));

      // Load audio data and create object URLs
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const logger = createRetrieveLogger(db);
      const tracksWithUrls = (
        await Promise.all(
          trackList.map(async (track) => {
            try {
              const data = await storage.measureRetrieve(
                track.storagePath,
                logger
              );
              assertPlainArrayBuffer(data);
              const blob = new Blob([data], { type: track.mimeType });
              const objectUrl = URL.createObjectURL(blob);

              let thumbnailUrl: string | null = null;
              if (track.thumbnailPath) {
                try {
                  const thumbData = await storage.measureRetrieve(
                    track.thumbnailPath,
                    logger
                  );
                  assertPlainArrayBuffer(thumbData);
                  const thumbBlob = new Blob([thumbData], {
                    type: 'image/jpeg'
                  });
                  thumbnailUrl = URL.createObjectURL(thumbBlob);
                } catch (err) {
                  console.warn(
                    `Failed to load thumbnail for ${track.name}:`,
                    err
                  );
                }
              }

              return { ...track, objectUrl, thumbnailUrl };
            } catch (err) {
              console.error(`Failed to load track ${track.name}:`, err);
              return null;
            }
          })
        )
      ).filter((t): t is AudioWithUrl => t !== null);

      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch tracks:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, playlistId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tracks intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance or playlist
    const instanceChanged = fetchedForInstanceRef.current !== currentInstanceId;
    const playlistChanged = fetchedForPlaylistRef.current !== playlistId;
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || instanceChanged || playlistChanged);

    if (needsFetch) {
      // If instance or playlist changed, cleanup old object URLs first
      if (
        (instanceChanged || playlistChanged) &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const track of tracks) {
          if (track.id !== currentTrackRef.current?.id) {
            URL.revokeObjectURL(track.objectUrl);
          }
          if (track.thumbnailUrl) {
            URL.revokeObjectURL(track.thumbnailUrl);
          }
        }
        setTracks([]);
        setError(null);
      }

      // Update refs before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;
      fetchedForPlaylistRef.current = playlistId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchTracks();
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
    fetchTracks
  ]);

  // Keep currentTrackRef in sync with currentTrack
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Cleanup object URLs on unmount, except for the currently playing track
  useEffect(() => {
    return () => {
      for (const t of tracks) {
        if (t.id !== currentTrackRef.current?.id) {
          URL.revokeObjectURL(t.objectUrl);
        }
        if (t.thumbnailUrl) {
          URL.revokeObjectURL(t.thumbnailUrl);
        }
      }
    };
  }, [tracks]);

  return {
    tracks,
    setTracks,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchTracks
  };
}
