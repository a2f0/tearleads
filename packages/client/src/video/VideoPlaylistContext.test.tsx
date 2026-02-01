import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useVideoPlaylistContext,
  useVideoPlaylistDatabaseState,
  VideoPlaylistProvider
} from './VideoPlaylistContext';

const createWrapper = () => {
  const mockDatabaseState = {
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <VideoPlaylistProvider
        databaseState={mockDatabaseState}
        fetchPlaylists={vi.fn(async () => [])}
        createPlaylist={vi.fn(async () => 'playlist-1')}
        renamePlaylist={vi.fn(async () => {})}
        deletePlaylist={vi.fn(async () => {})}
        addTrackToPlaylist={vi.fn(async () => {})}
        removeTrackFromPlaylist={vi.fn(async () => {})}
        getTrackIdsInPlaylist={vi.fn(async () => [])}
        logError={vi.fn()}
      >
        {children}
      </VideoPlaylistProvider>
    );
  };
};

describe('VideoPlaylistContext', () => {
  describe('useVideoPlaylistContext', () => {
    it('provides context values when used within provider', () => {
      const { result } = renderHook(() => useVideoPlaylistContext(), {
        wrapper: createWrapper()
      });

      expect(result.current.databaseState).toBeDefined();
      expect(result.current.databaseState.isUnlocked).toBe(true);
      expect(result.current.fetchPlaylists).toBeDefined();
      expect(result.current.createPlaylist).toBeDefined();
      expect(result.current.renamePlaylist).toBeDefined();
      expect(result.current.deletePlaylist).toBeDefined();
      expect(result.current.addTrackToPlaylist).toBeDefined();
      expect(result.current.removeTrackFromPlaylist).toBeDefined();
      expect(result.current.getTrackIdsInPlaylist).toBeDefined();
      expect(result.current.logError).toBeDefined();
    });

    it('throws error when used outside provider', () => {
      expect(() => {
        renderHook(() => useVideoPlaylistContext());
      }).toThrow(
        'useVideoPlaylistContext must be used within a VideoPlaylistProvider'
      );
    });
  });

  describe('useVideoPlaylistDatabaseState', () => {
    it('returns database state from context', () => {
      const { result } = renderHook(() => useVideoPlaylistDatabaseState(), {
        wrapper: createWrapper()
      });

      expect(result.current.isUnlocked).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.currentInstanceId).toBe('test-instance');
    });
  });

  describe('VideoPlaylistProvider', () => {
    it('passes through all props to context', async () => {
      const fetchPlaylists = vi.fn(async () => []);
      const createPlaylist = vi.fn(async () => 'new-id');
      const renamePlaylist = vi.fn(async () => {});
      const deletePlaylist = vi.fn(async () => {});
      const addTrackToPlaylist = vi.fn(async () => {});
      const removeTrackFromPlaylist = vi.fn(async () => {});
      const getTrackIdsInPlaylist = vi.fn(async () => ['video-1']);
      const logError = vi.fn();

      const mockDatabaseState = {
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <VideoPlaylistProvider
          databaseState={mockDatabaseState}
          fetchPlaylists={fetchPlaylists}
          createPlaylist={createPlaylist}
          renamePlaylist={renamePlaylist}
          deletePlaylist={deletePlaylist}
          addTrackToPlaylist={addTrackToPlaylist}
          removeTrackFromPlaylist={removeTrackFromPlaylist}
          getTrackIdsInPlaylist={getTrackIdsInPlaylist}
          logError={logError}
        >
          {children}
        </VideoPlaylistProvider>
      );

      const { result } = renderHook(() => useVideoPlaylistContext(), {
        wrapper
      });

      // Verify database state
      expect(result.current.databaseState.isUnlocked).toBe(false);
      expect(result.current.databaseState.isLoading).toBe(true);
      expect(result.current.databaseState.currentInstanceId).toBeNull();

      // Verify functions are passed through
      await result.current.fetchPlaylists();
      expect(fetchPlaylists).toHaveBeenCalled();

      await result.current.createPlaylist('test');
      expect(createPlaylist).toHaveBeenCalledWith('test');

      await result.current.renamePlaylist('id', 'name');
      expect(renamePlaylist).toHaveBeenCalledWith('id', 'name');

      await result.current.deletePlaylist('id');
      expect(deletePlaylist).toHaveBeenCalledWith('id');

      await result.current.addTrackToPlaylist('pid', 'vid');
      expect(addTrackToPlaylist).toHaveBeenCalledWith('pid', 'vid');

      await result.current.removeTrackFromPlaylist('pid', 'vid');
      expect(removeTrackFromPlaylist).toHaveBeenCalledWith('pid', 'vid');

      const trackIds = await result.current.getTrackIdsInPlaylist('pid');
      expect(getTrackIdsInPlaylist).toHaveBeenCalledWith('pid');
      expect(trackIds).toEqual(['video-1']);

      result.current.logError('error', 'details');
      expect(logError).toHaveBeenCalledWith('error', 'details');
    });
  });
});
