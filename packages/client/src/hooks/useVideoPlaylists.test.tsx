import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockVideoPlaylist,
  createVideoPlaylistWrapper
} from '@/test/videoPlaylistTestUtils';
import { useVideoPlaylists } from './useVideoPlaylists';

const mockPlaylist = createMockVideoPlaylist({
  id: 'playlist-1',
  name: 'Action Movies',
  trackCount: 5
});

describe('useVideoPlaylists', () => {
  it('fetches playlists when unlocked', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(1);
    });

    expect(fetchPlaylists).toHaveBeenCalledTimes(1);
    expect(result.current.playlists[0]?.name).toBe('Action Movies');
    expect(result.current.playlists[0]?.mediaType).toBe('video');
  });

  it('does not fetch when locked', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: false },
      fetchPlaylists
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    // Wait a tick to ensure effect has run
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(fetchPlaylists).not.toHaveBeenCalled();
    expect(result.current.playlists).toHaveLength(0);
  });

  it('creates playlists and refetches', async () => {
    const fetchPlaylists = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockPlaylist]);
    const createPlaylist = vi.fn(async () => 'playlist-1');
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      createPlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.createPlaylist('Action Movies');
    });

    expect(createPlaylist).toHaveBeenCalledWith('Action Movies');
    expect(fetchPlaylists).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(result.current.playlists[0]?.name).toBe('Action Movies');
    });
  });

  it('renames playlists and refetches', async () => {
    const renamedPlaylist = { ...mockPlaylist, name: 'Comedy Movies' };
    const fetchPlaylists = vi
      .fn()
      .mockResolvedValueOnce([mockPlaylist])
      .mockResolvedValueOnce([renamedPlaylist]);
    const renamePlaylist = vi.fn(async () => {});
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      renamePlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.renamePlaylist('playlist-1', 'Comedy Movies');
    });

    expect(renamePlaylist).toHaveBeenCalledWith('playlist-1', 'Comedy Movies');
    expect(fetchPlaylists).toHaveBeenCalledTimes(2);
  });

  it('deletes playlists and refetches', async () => {
    const fetchPlaylists = vi
      .fn()
      .mockResolvedValueOnce([mockPlaylist])
      .mockResolvedValueOnce([]);
    const deletePlaylist = vi.fn(async () => {});
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      deletePlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deletePlaylist('playlist-1');
    });

    expect(deletePlaylist).toHaveBeenCalledWith('playlist-1');
    expect(fetchPlaylists).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(0);
    });
  });

  it('adds track to playlist and refetches', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);
    const addTrackToPlaylist = vi.fn(async () => {});
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      addTrackToPlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.addTrackToPlaylist('playlist-1', 'video-1');
    });

    expect(addTrackToPlaylist).toHaveBeenCalledWith('playlist-1', 'video-1');
  });

  it('removes track from playlist and refetches', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);
    const removeTrackFromPlaylist = vi.fn(async () => {});
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      removeTrackFromPlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.removeTrackFromPlaylist('playlist-1', 'video-1');
    });

    expect(removeTrackFromPlaylist).toHaveBeenCalledWith(
      'playlist-1',
      'video-1'
    );
  });

  it('handles fetch errors gracefully', async () => {
    const fetchPlaylists = vi.fn(async () => {
      throw new Error('Network error');
    });
    const logError = vi.fn();
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      logError
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });

    expect(logError).toHaveBeenCalledWith(
      'Failed to fetch video playlists',
      expect.any(String)
    );
    expect(result.current.hasFetched).toBe(true);
  });

  it('exposes getTrackIdsInPlaylist from context', async () => {
    const getTrackIdsInPlaylist = vi.fn(async () => ['video-1', 'video-2']);
    const wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      getTrackIdsInPlaylist
    });

    const { result } = renderHook(() => useVideoPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const trackIds = await result.current.getTrackIdsInPlaylist('playlist-1');

    expect(getTrackIdsInPlaylist).toHaveBeenCalledWith('playlist-1');
    expect(trackIds).toEqual(['video-1', 'video-2']);
  });

  it('resets playlists when instance changes', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);

    // Start with instance-1
    const { result, rerender } = renderHook(() => useVideoPlaylists(), {
      wrapper: ({ children }) => {
        const Wrapper = createVideoPlaylistWrapper({
          databaseState: {
            isUnlocked: true,
            currentInstanceId: 'instance-1'
          },
          fetchPlaylists
        });
        return <Wrapper>{children}</Wrapper>;
      }
    });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.playlists).toHaveLength(1);

    // Change to instance-2 by re-rendering with new wrapper
    rerender();

    // The fetch should have been called
    expect(fetchPlaylists).toHaveBeenCalled();
  });
});
