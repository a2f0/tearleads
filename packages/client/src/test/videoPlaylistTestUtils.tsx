import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type {
  DatabaseState,
  VideoPlaylist,
  VideoPlaylistContextValue
} from '@/video/VideoPlaylistContext';
import { VideoPlaylistProvider } from '@/video/VideoPlaylistContext';

const createMockDatabaseState = (
  overrides: Partial<DatabaseState> = {}
): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance',
  ...overrides
});

export const createMockVideoPlaylist = (
  overrides: Partial<VideoPlaylist> = {}
): VideoPlaylist => ({
  id: 'playlist-1',
  name: 'Test Playlist',
  trackCount: 0,
  coverImageId: null,
  mediaType: 'video',
  ...overrides
});

interface MockVideoPlaylistContextOptions {
  databaseState?: Partial<DatabaseState>;
  fetchPlaylists?: () => Promise<VideoPlaylist[]>;
  createPlaylist?: (name: string) => Promise<string>;
  renamePlaylist?: (playlistId: string, newName: string) => Promise<void>;
  deletePlaylist?: (playlistId: string) => Promise<void>;
  addTrackToPlaylist?: (playlistId: string, videoId: string) => Promise<void>;
  removeTrackFromPlaylist?: (
    playlistId: string,
    videoId: string
  ) => Promise<void>;
  getTrackIdsInPlaylist?: (playlistId: string) => Promise<string[]>;
  logError?: (message: string, details?: string) => void;
}

function createMockVideoPlaylistContextValue(
  options: MockVideoPlaylistContextOptions = {}
): VideoPlaylistContextValue {
  return {
    databaseState: createMockDatabaseState(options.databaseState),
    fetchPlaylists: options.fetchPlaylists ?? vi.fn(async () => []),
    createPlaylist: options.createPlaylist ?? vi.fn(async () => 'playlist-1'),
    renamePlaylist: options.renamePlaylist ?? vi.fn(async () => {}),
    deletePlaylist: options.deletePlaylist ?? vi.fn(async () => {}),
    addTrackToPlaylist: options.addTrackToPlaylist ?? vi.fn(async () => {}),
    removeTrackFromPlaylist:
      options.removeTrackFromPlaylist ?? vi.fn(async () => {}),
    getTrackIdsInPlaylist:
      options.getTrackIdsInPlaylist ?? vi.fn(async () => []),
    logError: options.logError ?? vi.fn()
  };
}

export function createVideoPlaylistWrapper(
  options: MockVideoPlaylistContextOptions = {}
) {
  const contextValue = createMockVideoPlaylistContextValue(options);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <VideoPlaylistProvider
        databaseState={contextValue.databaseState}
        fetchPlaylists={contextValue.fetchPlaylists}
        createPlaylist={contextValue.createPlaylist}
        renamePlaylist={contextValue.renamePlaylist}
        deletePlaylist={contextValue.deletePlaylist}
        addTrackToPlaylist={contextValue.addTrackToPlaylist}
        removeTrackFromPlaylist={contextValue.removeTrackFromPlaylist}
        getTrackIdsInPlaylist={contextValue.getTrackIdsInPlaylist}
        logError={contextValue.logError}
      >
        {children}
      </VideoPlaylistProvider>
    );
  };
}
