import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../../test/testUtils';
import { useAudioPlaylists } from './useAudioPlaylists';

const mockPlaylist = {
  id: 'playlist-1',
  name: 'Morning Mix',
  trackCount: 2,
  coverImageId: null
};

describe('useAudioPlaylists', () => {
  it('fetches playlists when unlocked', async () => {
    const fetchPlaylists = vi.fn(async () => [mockPlaylist]);
    const wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    const { result } = renderHook(() => useAudioPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(1);
    });

    expect(fetchPlaylists).toHaveBeenCalledTimes(1);
  });

  it('creates playlists and refetches', async () => {
    const fetchPlaylists = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockPlaylist]);
    const createPlaylist = vi.fn(async () => 'playlist-1');
    const wrapper = createWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      createPlaylist
    });

    const { result } = renderHook(() => useAudioPlaylists(), { wrapper });

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    await act(async () => {
      await result.current.createPlaylist('Morning Mix');
    });

    expect(createPlaylist).toHaveBeenCalledWith('Morning Mix');
    expect(fetchPlaylists).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(result.current.playlists[0]?.name).toBe('Morning Mix');
    });
  });
});
