/**
 * Hook for audio table data fetching.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AudioWithUrl,
  useAudioUIContext
} from '../../../context/AudioUIContext';
import { ALL_AUDIO_ID } from '../AudioPlaylistsSidebar';
import type { SortColumn, SortDirection } from './types';

interface UseAudioTableDataOptions {
  selectedPlaylistId?: string | null | undefined;
  showDeleted?: boolean | undefined;
  refreshToken?: number | undefined;
}

export function useAudioTableData({
  selectedPlaylistId,
  showDeleted = false,
  refreshToken = 0
}: UseAudioTableDataOptions) {
  const {
    databaseState,
    fetchAudioFilesWithUrls,
    getTrackIdsInPlaylist,
    logError
  } = useAudioUIContext();
  const { isUnlocked, currentInstanceId } = databaseState;

  const [tracks, setTracks] = useState<AudioWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const currentTrackRef = useRef<{ id: string } | null>(null);

  const fetchTracks = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      let trackIds: string[] | null = null;
      if (selectedPlaylistId && selectedPlaylistId !== ALL_AUDIO_ID) {
        trackIds = await getTrackIdsInPlaylist(selectedPlaylistId);
        if (trackIds.length === 0) {
          setTracks([]);
          setHasFetched(true);
          setLoading(false);
          return;
        }
      }

      const tracksWithUrls = await fetchAudioFilesWithUrls(
        trackIds ?? undefined,
        showDeleted
      );
      setTracks(tracksWithUrls);
      setHasFetched(true);
    } catch (err) {
      logError('Failed to fetch tracks', String(err));
      setError(err instanceof Error ? err.message : String(err));
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [
    fetchAudioFilesWithUrls,
    getTrackIdsInPlaylist,
    isUnlocked,
    logError,
    selectedPlaylistId,
    showDeleted
  ]);

  const fetchedForFilterRef = useRef<string | null>(null);

  useEffect(() => {
    const filterKey = selectedPlaylistId ?? ALL_AUDIO_ID;
    const fetchKey = `${currentInstanceId ?? 'none'}:${filterKey}:${showDeleted ? 'all' : 'active'}`;

    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForFilterRef.current !== fetchKey);

    if (needsFetch) {
      if (
        fetchedForFilterRef.current !== fetchKey &&
        fetchedForFilterRef.current !== null
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
        setHasFetched(false);
      }

      fetchedForFilterRef.current = fetchKey;

      const timeoutId = setTimeout(() => {
        fetchTracks();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    currentInstanceId,
    fetchTracks,
    hasFetched,
    isUnlocked,
    loading,
    selectedPlaylistId,
    showDeleted,
    tracks
  ]);

  useEffect(() => {
    if (!isUnlocked || refreshToken === 0 || !hasFetched) return;
    fetchTracks();
  }, [fetchTracks, hasFetched, isUnlocked, refreshToken]);

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
    fetchTracks,
    currentTrackRef
  };
}

export function useAudioTableSort(tracks: AudioWithUrl[], searchQuery: string) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const filteredAndSortedTracks = useMemo(() => {
    const filtered = tracks.filter((track) => {
      const searchLower = searchQuery.toLowerCase();
      return track.name.toLowerCase().includes(searchLower);
    });

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'mimeType':
          comparison = a.mimeType.localeCompare(b.mimeType);
          break;
        case 'uploadDate':
          comparison = a.uploadDate.getTime() - b.uploadDate.getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [tracks, searchQuery, sortColumn, sortDirection]);

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevColumn;
      }
      setSortDirection('asc');
      return column;
    });
  }, []);

  return {
    sortColumn,
    sortDirection,
    filteredAndSortedTracks,
    handleSortChange
  };
}
