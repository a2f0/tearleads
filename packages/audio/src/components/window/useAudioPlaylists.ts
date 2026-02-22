import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AudioPlaylist,
  useAudioUIContext
} from '../../context/AudioUIContext';

interface UseAudioPlaylistsResult {
  playlists: AudioPlaylist[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
  createPlaylist: (name: string) => Promise<string>;
  renamePlaylist: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, audioId: string) => Promise<void>;
  removeTrackFromPlaylist: (
    playlistId: string,
    audioId: string
  ) => Promise<void>;
  getTrackIdsInPlaylist: (playlistId: string) => Promise<string[]>;
}

export function useAudioPlaylists(): UseAudioPlaylistsResult {
  const {
    databaseState,
    fetchPlaylists,
    createPlaylist: createPlaylistInDb,
    renamePlaylist: renamePlaylistInDb,
    deletePlaylist: deletePlaylistInDb,
    addTrackToPlaylist: addTrackToPlaylistInDb,
    removeTrackFromPlaylist: removeTrackFromPlaylistInDb,
    getTrackIdsInPlaylist,
    logError
  } = useAudioUIContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [playlistList, setPlaylistList] = useState<AudioPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchPlaylistList = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const playlists = await fetchPlaylists();
      setPlaylistList(playlists);
      setHasFetched(true);
    } catch (err) {
      logError('Failed to fetch playlists', String(err));
      setError(err instanceof Error ? err.message : String(err));
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPlaylists, isUnlocked, logError]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setPlaylistList([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchPlaylistList();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [fetchPlaylistList, hasFetched, isUnlocked, loading, currentInstanceId]);

  const createPlaylist = useCallback(
    async (name: string): Promise<string> => {
      const id = await createPlaylistInDb(name);
      await fetchPlaylistList();
      return id;
    },
    [createPlaylistInDb, fetchPlaylistList]
  );

  const renamePlaylist = useCallback(
    async (playlistId: string, newName: string): Promise<void> => {
      await renamePlaylistInDb(playlistId, newName);
      await fetchPlaylistList();
    },
    [renamePlaylistInDb, fetchPlaylistList]
  );

  const deletePlaylist = useCallback(
    async (playlistId: string): Promise<void> => {
      await deletePlaylistInDb(playlistId);
      await fetchPlaylistList();
    },
    [deletePlaylistInDb, fetchPlaylistList]
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId: string, audioId: string): Promise<void> => {
      await addTrackToPlaylistInDb(playlistId, audioId);
      await fetchPlaylistList();
    },
    [addTrackToPlaylistInDb, fetchPlaylistList]
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: string, audioId: string): Promise<void> => {
      await removeTrackFromPlaylistInDb(playlistId, audioId);
      await fetchPlaylistList();
    },
    [removeTrackFromPlaylistInDb, fetchPlaylistList]
  );

  return {
    playlists: playlistList,
    loading,
    error,
    hasFetched,
    refetch: fetchPlaylistList,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    getTrackIdsInPlaylist
  };
}
