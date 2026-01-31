import { render, screen } from '@testing-library/react';
import type { AudioUIProviderProps } from '@rapid/audio';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioAboutMenuItem, ClientAudioProvider } from './ClientAudioProvider';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

let lastProviderProps: AudioUIProviderProps | null = null;

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => null
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn()
  })
}));

vi.mock('@rapid/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rapid/audio')>();
  return {
    ...actual,
    AudioUIProvider: (props: AudioUIProviderProps) => {
      lastProviderProps = props;
      return <div data-testid="audio-ui-provider">{props.children}</div>;
    }
  };
});

vi.mock('@rapid/audio/package.json', () => ({
  default: { version: '0.0.1' }
}));

vi.mock('@/components/window-menu/AboutMenuItem', () => ({
  AboutMenuItem: ({
    appName,
    version
  }: {
    appName: string;
    version: string;
  }) => (
    <div data-testid="about-menu-item">
      {appName} v{version}
    </div>
  )
}));

describe('ClientAudioProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastProviderProps = null;
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it('renders children wrapped in AudioUIProvider', () => {
    render(
      <ClientAudioProvider>
        <div data-testid="child">Test Child</div>
      </ClientAudioProvider>
    );

    expect(screen.getByTestId('audio-ui-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('fetches playlists from the database', async () => {
    const playlistRows = [
      { id: 'playlist-1', name: 'Morning Mix', coverImageId: null }
    ];
    const linkRows = [{ parentId: 'playlist-1' }, { parentId: 'playlist-1' }];

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => playlistRows)
          }))
        }))
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(async () => linkRows)
        }))
      });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const playlists = await lastProviderProps.fetchPlaylists();

    expect(playlists).toEqual([
      {
        id: 'playlist-1',
        name: 'Morning Mix',
        trackCount: 2,
        coverImageId: null
      }
    ]);
  });

  it('fetches empty playlists without links', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => [])
        }))
      }))
    });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const playlists = await lastProviderProps.fetchPlaylists();
    expect(playlists).toEqual([]);
  });

  it('fetches audio files by id filter and handles empty ids', async () => {
    const fileRows = [
      {
        id: 'track-1',
        name: 'Test Track.mp3',
        size: 123,
        mimeType: 'audio/mpeg',
        uploadDate: new Date('2024-01-01'),
        storagePath: '/audio/test-track.mp3',
        thumbnailPath: null
      }
    ];

    const createOrderableResult = <T,>(value: T) => {
      const result = Promise.resolve(value);
      return Object.assign(result, {
        orderBy: vi.fn(async () => value)
      });
    };

    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => createOrderableResult(fileRows))
      }))
    });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const emptyResult = await lastProviderProps.fetchAudioFiles([]);
    expect(emptyResult).toEqual([]);

    const filtered = await lastProviderProps.fetchAudioFiles(['track-1']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('track-1');
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
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const playlistId = await lastProviderProps.createPlaylist('Focus');
    expect(playlistId).toBeTruthy();
    expect(insertValues).toHaveBeenCalledTimes(2);

    await lastProviderProps.renamePlaylist('playlist-1', 'New Name');
    expect(updateWhere).toHaveBeenCalledTimes(1);

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
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    await lastProviderProps.addTrackToPlaylist('playlist-1', 'track-1');
    expect(insertValues).toHaveBeenCalledTimes(1);

    await lastProviderProps.removeTrackFromPlaylist('playlist-1', 'track-1');
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
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    await lastProviderProps.addTrackToPlaylist('playlist-1', 'track-1');
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('fetches track ids for a playlist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ childId: 'track-1' }])
      }))
    });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const ids = await lastProviderProps.getTrackIdsInPlaylist('playlist-1');
    expect(ids).toEqual(['track-1']);
  });

  it('throws when fetching audio urls without an encryption key', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve([]), {
            orderBy: vi.fn(async () => [])
          })
        )
      }))
    });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    await expect(lastProviderProps.fetchAudioFilesWithUrls()).rejects.toThrow(
      'Database not unlocked'
    );
  });
});

describe('AudioAboutMenuItem', () => {
  it('renders AboutMenuItem with correct props', () => {
    render(<AudioAboutMenuItem />);

    expect(screen.getByTestId('about-menu-item')).toHaveTextContent(
      'Audio v0.0.1'
    );
  });
});
