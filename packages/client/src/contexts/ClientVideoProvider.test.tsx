import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoPlaylistProviderProps } from '@/video/VideoPlaylistContext';
import { ClientVideoProvider } from './ClientVideoProvider';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

let lastProviderProps: VideoPlaylistProviderProps | null = null;

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/video/VideoPlaylistContext', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/video/VideoPlaylistContext')>();
  return {
    ...actual,
    VideoPlaylistProvider: (props: VideoPlaylistProviderProps) => {
      lastProviderProps = props;
      return <div data-testid="video-playlist-provider">{props.children}</div>;
    }
  };
});

describe('ClientVideoProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastProviderProps = null;
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it('renders children wrapped in VideoPlaylistProvider', () => {
    render(
      <ClientVideoProvider>
        <div data-testid="child">Test Child</div>
      </ClientVideoProvider>
    );

    expect(screen.getByTestId('video-playlist-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('fetches playlists from the database', async () => {
    const playlistRows = [
      {
        id: 'playlist-1',
        name: 'Action Movies',
        coverImageId: null,
        mediaType: 'video' as const,
        trackCount: 3
      }
    ];
    const trackCountsSubQuery = { parentId: 'parent_id', trackCount: 0 };

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              groupBy: vi.fn(() => ({
                as: vi.fn(() => trackCountsSubQuery)
              }))
            }))
          }))
        }))
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(async () => playlistRows)
            }))
          }))
        }))
      });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    const playlists = await lastProviderProps.fetchPlaylists();

    expect(playlists).toEqual([
      {
        id: 'playlist-1',
        name: 'Action Movies',
        trackCount: 3,
        coverImageId: null,
        mediaType: 'video'
      }
    ]);
  });

  it('fetches empty playlists without links', async () => {
    const trackCountsSubQuery = { parentId: 'parent_id', trackCount: 0 };

    mockDb.select.mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => ({
              as: vi.fn(() => trackCountsSubQuery)
            }))
          }))
        }))
      }))
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(async () => [])
          }))
        }))
      }))
    });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    const playlists = await lastProviderProps.fetchPlaylists();
    expect(playlists).toEqual([]);
  });

  it('count subquery joins files and filters deleted', async () => {
    const trackCountsSubQuery = { parentId: 'parent_id', trackCount: 0 };

    const innerJoinFn = vi.fn(() => ({
      where: vi.fn(() => ({
        groupBy: vi.fn(() => ({
          as: vi.fn(() => trackCountsSubQuery)
        }))
      }))
    }));

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: innerJoinFn
        }))
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(async () => [])
            }))
          }))
        }))
      });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    await lastProviderProps.fetchPlaylists();

    // The subquery should call innerJoin to join with files table
    expect(innerJoinFn).toHaveBeenCalled();
  });

  it('creates, renames, and deletes playlists', async () => {
    const insertValues = vi.fn(async () => undefined);
    const updateWhere = vi.fn(async () => undefined);
    const deleteWhere = vi.fn(async () => undefined);

    mockDb.insert.mockReturnValue({ values: insertValues });
    mockDb.update.mockReturnValue({
      set: vi.fn(() => ({ where: updateWhere }))
    });
    mockDb.delete.mockReturnValue({ where: deleteWhere });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    const playlistId = await lastProviderProps.createPlaylist('Action Movies');
    expect(playlistId).toBeTruthy();
    expect(insertValues).toHaveBeenCalledTimes(2);

    await lastProviderProps.renamePlaylist('playlist-1', 'Comedy Movies');
    expect(updateWhere).toHaveBeenCalledTimes(2);

    await lastProviderProps.deletePlaylist('playlist-1');
    expect(deleteWhere).toHaveBeenCalledTimes(3);
  });

  it('adds and removes tracks in playlists', async () => {
    const insertValues = vi.fn(async () => undefined);
    const deleteWhere = vi.fn(async () => undefined);

    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [])
      }))
    });
    mockDb.insert.mockReturnValue({ values: insertValues });
    mockDb.delete.mockReturnValue({ where: deleteWhere });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    await lastProviderProps.addTrackToPlaylist('playlist-1', 'video-1');
    expect(insertValues).toHaveBeenCalledTimes(1);

    await lastProviderProps.removeTrackFromPlaylist('playlist-1', 'video-1');
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('skips adding a track when already linked', async () => {
    const insertValues = vi.fn(async () => undefined);

    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ id: 'link-1' }])
      }))
    });
    mockDb.insert.mockReturnValue({ values: insertValues });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    await lastProviderProps.addTrackToPlaylist('playlist-1', 'video-1');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('fetches track ids for a playlist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ childId: 'video-1' }])
      }))
    });

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    const ids = await lastProviderProps.getTrackIdsInPlaylist('playlist-1');
    expect(ids).toEqual(['video-1']);
  });

  it('passes database state to provider', () => {
    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    expect(lastProviderProps.databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });

  it('logs errors via logError callback', () => {
    const logStoreSpy = vi.fn();
    vi.doMock('@/stores/logStore', () => ({
      logStore: { error: logStoreSpy }
    }));

    render(
      <ClientVideoProvider>
        <div />
      </ClientVideoProvider>
    );

    if (!lastProviderProps)
      throw new Error('VideoPlaylistProvider not captured');

    // logError should be a function
    expect(typeof lastProviderProps.logError).toBe('function');
  });
});
