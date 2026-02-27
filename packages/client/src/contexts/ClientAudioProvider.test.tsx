import type { AudioUIProviderProps } from '@tearleads/audio';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioAboutMenuItem, ClientAudioProvider } from './ClientAudioProvider';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

let lastProviderProps: AudioUIProviderProps | null = null;
const mockUploadFile = vi.fn(async () => ({ id: 'uploaded-id' }));
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn(
  async (_data: Uint8Array, _filename: string, _mimeType: string) => true
);
const mockCanShareFiles = vi.fn(() => true);

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

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

vi.mock('@/lib/fileUtils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

vi.mock('@tearleads/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tearleads/audio')>();
  return {
    ...actual,
    AudioUIProvider: (props: AudioUIProviderProps) => {
      lastProviderProps = props;
      return <div data-testid="audio-ui-provider">{props.children}</div>;
    }
  };
});

vi.mock('@tearleads/audio/package.json', () => ({
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
    mockUploadFile.mockClear();
    mockDownloadFile.mockClear();
    mockShareFile.mockClear();
    mockCanShareFiles.mockClear();
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
      {
        id: 'playlist-1',
        name: 'Morning Mix',
        coverImageId: null,
        trackCount: 2
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
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

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
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    await lastProviderProps.fetchPlaylists();

    // The subquery should call innerJoin to join with files table
    expect(innerJoinFn).toHaveBeenCalled();
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
    expect(updateWhere).toHaveBeenCalledTimes(2);

    await lastProviderProps.deletePlaylist('playlist-1');
    expect(deleteWhere).toHaveBeenCalledTimes(3);
  });

  it('adds and removes tracks in playlists', async () => {
    const insertValues = vi.fn(async () => undefined);
    const deleteWhere = vi.fn(async () => undefined);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(async () => [])
        }))
      })
      .mockReturnValueOnce({
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
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          parentId: 'playlist-1',
          childId: 'track-1'
        })
      ])
    );

    await lastProviderProps.removeTrackFromPlaylist('playlist-1', 'track-1');
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('skips adding a track when already linked', async () => {
    const insertValues = vi.fn(async () => undefined);

    mockDb.select
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: 'track-1' }])
        }))
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ childId: 'track-1' }])
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
    expect(insertValues).toHaveBeenCalledTimes(0);
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

  it('soft deletes and restores audio files', async () => {
    const updateWhere = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));

    mockDb.update.mockReturnValue({ set: updateSet });

    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    await lastProviderProps.softDeleteAudio('track-1');
    await lastProviderProps.restoreAudio('track-1');

    expect(updateSet).toHaveBeenNthCalledWith(1, { deleted: true });
    expect(updateSet).toHaveBeenNthCalledWith(2, { deleted: false });
    expect(updateWhere).toHaveBeenCalledTimes(2);
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

  it('exposes upload and file utility handlers', async () => {
    render(
      <ClientAudioProvider>
        <div />
      </ClientAudioProvider>
    );

    if (!lastProviderProps) throw new Error('AudioUIProvider not captured');

    const uploadResult = await lastProviderProps.uploadFile(
      new File(['audio'], 'sample.mp3', { type: 'audio/mpeg' })
    );
    expect(uploadResult).toBe('uploaded-id');

    lastProviderProps.downloadFile(new Uint8Array([1, 2, 3]), 'sample.mp3');
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'sample.mp3'
    );

    const didShare = await lastProviderProps.shareFile(
      new Uint8Array([1, 2, 3]),
      'sample.mp3',
      'audio/mpeg'
    );
    expect(didShare).toBe(true);
    expect(mockShareFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'sample.mp3',
      'audio/mpeg'
    );

    expect(lastProviderProps.canShareFiles()).toBe(true);
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
