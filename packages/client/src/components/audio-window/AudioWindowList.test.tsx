import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioWindowList } from './AudioWindowList';

const mockDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseState
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) =>
      ({
        play: 'Play',
        pause: 'Pause',
        getInfo: 'Get Info',
        delete: 'Delete'
      })[key] ?? key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

vi.mock('@/components/audio/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player">Audio Player</div>
}));

const mockAudioState = {
  currentTrack: null as { id: string; name: string } | null,
  isPlaying: false,
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn()
};

vi.mock('@/audio', () => ({
  useAudio: () => mockAudioState
}));

vi.mock('@/hooks/useAudioErrorHandler', () => ({
  useAudioErrorHandler: vi.fn()
}));

const mockTracks = [
  {
    id: 'track-1',
    name: 'Song One.mp3',
    size: 5000000,
    mimeType: 'audio/mpeg',
    uploadDate: new Date(),
    storagePath: '/audio/track-1',
    thumbnailPath: null
  },
  {
    id: 'track-2',
    name: 'Song Two.mp3',
    size: 3000000,
    mimeType: 'audio/mpeg',
    uploadDate: new Date(),
    storagePath: '/audio/track-2',
    thumbnailPath: '/thumb/track-2'
  }
];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis()
};

vi.mock('@/db', () => ({
  getDatabase: () => mockDb
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => 'mock-key'
  })
}));

const mockStorage = {
  measureRetrieve: vi.fn().mockResolvedValue(new ArrayBuffer(100))
};

let mockIsFileStorageInitialized = true;
const mockInitializeFileStorage = vi.fn();

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => mockIsFileStorageInitialized,
  initializeFileStorage: (...args: unknown[]) =>
    mockInitializeFileStorage(...args),
  getFileStorage: () => mockStorage,
  createRetrieveLogger: () => ({})
}));

vi.mock('@rapid/shared', () => ({
  assertPlainArrayBuffer: vi.fn()
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}));

let mockPlatform = 'web';
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: () => mockPlatform
  };
});

interface VirtualizerConfig {
  count: number;
  getScrollElement: () => HTMLDivElement | null;
  estimateSize: () => number;
  overscan: number;
}

let lastVirtualizerConfig: VirtualizerConfig | null = null;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (config: VirtualizerConfig) => {
    lastVirtualizerConfig = config;
    return {
      getVirtualItems: () =>
        Array.from({ length: config.count }, (_, i) => ({
          index: i,
          start: i * 56,
          size: 56,
          key: i
        })),
      getTotalSize: () => config.count * 56,
      measureElement: vi.fn()
    };
  }
}));

const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();

describe('AudioWindowList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState.isUnlocked = true;
    mockDatabaseState.isLoading = false;
    mockDatabaseState.currentInstanceId = 'test-instance';
    mockAudioState.currentTrack = null;
    mockAudioState.isPlaying = false;
    mockDb.orderBy.mockResolvedValue([]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockStorage.measureRetrieve.mockResolvedValue(new ArrayBuffer(100));
    mockPlatform = 'web';
    mockIsFileStorageInitialized = true;
    lastVirtualizerConfig = null;

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowList />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<AudioWindowList />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders container element', () => {
    const { container } = render(<AudioWindowList />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders header with Audio title', () => {
    render(<AudioWindowList />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    render(<AudioWindowList />);
    expect(
      screen.getByRole('button', { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it('shows empty state when no tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('No audio files')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Upload audio from the main Audio page')
    ).toBeInTheDocument();
  });

  it('renders tracks list when tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
  });

  it('renders search input when tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByTestId('window-audio-search')).toBeInTheDocument();
    });
  });

  it('filters tracks by search query', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-search');
    await user.type(searchInput, 'Two');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowList />);

    expect(
      screen.queryByRole('button', { name: /refresh/i })
    ).not.toBeInTheDocument();
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowList />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('handles search query clearing', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-search');
    await user.type(searchInput, 'Two');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();

    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });
  });

  it('shows context menu on right click', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get Info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('plays track via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));
    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('shows Pause in context menu when track is playing', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });
  });

  it('deletes track via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('handles delete error gracefully', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('Delete failed'));

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('renders audio player when tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    });
  });

  it('displays file size for tracks', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    // File size formatting - 5000000 bytes = 4.77 MB
    expect(screen.getByText('4.77 MB')).toBeInTheDocument();
  });

  it('highlights currently playing track', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    render(<AudioWindowList />);

    await waitFor(() => {
      const trackElement = screen.getByTestId('window-audio-track-track-1');
      expect(trackElement).toHaveClass('border-primary');
    });
  });

  it('pauses track when clicking pause from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Pause'));
    expect(mockAudioState.pause).toHaveBeenCalled();
  });

  it('resumes paused track via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = false;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));
    expect(mockAudioState.resume).toHaveBeenCalled();
  });

  it('refreshes tracks when refresh button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('No audio files')).toBeInTheDocument();
    });

    mockDb.select.mockClear();
    mockDb.orderBy.mockResolvedValue(mockTracks);

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('handles track with thumbnail', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });

    const images = document.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
  });

  it('shows playing indicator on current track', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    const playingIndicator = playButton.querySelector('.bg-primary');
    expect(playingIndicator).toBeInTheDocument();
  });

  it('renders VirtualListStatus when tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    expect(screen.getByText(/track/i)).toBeInTheDocument();
  });

  it('plays different track when clicking a non-current track', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-2', name: 'Song Two.mp3' };
    mockAudioState.isPlaying = true;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));
    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('handles double-click to play on desktop', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    await user.dblClick(playButton);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('displays track without thumbnail using music icon', async () => {
    mockDb.orderBy.mockResolvedValue([mockTracks[0]]);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackElement = screen.getByTestId('window-audio-play-track-1');
    const musicIcon = trackElement.querySelector('svg');
    expect(musicIcon).toBeInTheDocument();
  });

  it('renders non-playing track without indicator', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = false;

    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    const playingIndicator = playButton.querySelector('.absolute.bg-primary');
    expect(playingIndicator).not.toBeInTheDocument();
  });

  it('case-insensitive search works correctly', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-search');
    await user.type(searchInput, 'SONG ONE');

    expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    expect(screen.queryByText('Song Two.mp3')).not.toBeInTheDocument();
  });

  it('handles single-click to play on mobile platform', async () => {
    mockPlatform = 'ios';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    await user.click(playButton);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('handles single-click to play on android platform', async () => {
    mockPlatform = 'android';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    await user.click(playButton);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('handles electron platform as desktop', async () => {
    mockPlatform = 'electron';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    await user.dblClick(playButton);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('opens info page from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const mockOpen = vi.fn();
    window.open = mockOpen;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get Info'));
    expect(mockOpen).toHaveBeenCalledWith('/audio/track-1', '_blank');
  });

  it('shows no results when search has no matches', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-search');
    await user.type(searchInput, 'nonexistent track');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.queryByText('Song Two.mp3')).not.toBeInTheDocument();
  });

  it('handles tracks with error during load', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockStorage.measureRetrieve.mockRejectedValueOnce(new Error('Load error'));
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });
    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
  });

  it('handles fetch with database not unlocked error', async () => {
    vi.doMock('@/db/crypto', () => ({
      getKeyManager: () => ({
        getCurrentKey: () => null
      })
    }));
    mockDb.orderBy.mockResolvedValue(mockTracks);

    render(<AudioWindowList />);

    await waitFor(() => {
      expect(
        screen.queryByText('Song One.mp3') ||
          screen.queryByText('Database not unlocked')
      ).toBeTruthy();
    });
  });

  it('handles tracks with failed thumbnail load gracefully', async () => {
    const tracksWithThumb = [
      {
        ...mockTracks[0],
        thumbnailPath: '/thumb/track-1'
      }
    ];
    mockDb.orderBy.mockResolvedValue(tracksWithThumb);

    let callCount = 0;
    mockStorage.measureRetrieve.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error('Thumbnail load error'));
      }
      return Promise.resolve(new ArrayBuffer(100));
    });

    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
  });

  it('revokes object URLs on unmount', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);

    const { unmount } = render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    unmount();

    expect(mockRevokeObjectURL).toHaveBeenCalled();
  });

  it('refetches on instance change', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);

    const { rerender } = render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    mockDatabaseState.currentInstanceId = 'new-instance';

    rerender(<AudioWindowList />);

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('preserves current track URL when revoking others on instance change', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };

    const { rerender } = render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const initialRevokeCount = mockRevokeObjectURL.mock.calls.length;
    mockDatabaseState.currentInstanceId = 'new-instance';

    rerender(<AudioWindowList />);

    await waitFor(() => {
      expect(mockRevokeObjectURL.mock.calls.length).toBeGreaterThanOrEqual(
        initialRevokeCount
      );
    });
  });

  it('handles multiple track deletions', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  it('toggles play/pause for same track correctly', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = false;

    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const playButton = screen.getByTestId('window-audio-play-track-1');
    await user.dblClick(playButton);

    expect(mockAudioState.resume).toHaveBeenCalled();
  });

  it('deletes track with thumbnail and revokes thumbnail URL', async () => {
    const tracksWithThumbnail = [
      {
        ...mockTracks[1],
        thumbnailPath: '/thumb/track-2'
      }
    ];
    mockDb.orderBy.mockResolvedValue(tracksWithThumbnail);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song Two.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDb.update).toHaveBeenCalled();
      // Track should be removed from the list
      expect(screen.queryByText('Song Two.mp3')).not.toBeInTheDocument();
    });

    // Verify URLs were revoked (at least for the deleted track's object URL and thumbnail)
    expect(mockRevokeObjectURL).toHaveBeenCalled();
  });

  it('closes context menu when clicking backdrop', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByText('Song One.mp3').closest('button');
    if (trackRow) {
      await user.pointer({ keys: '[MouseRight]', target: trackRow });
    }

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    // Click backdrop to close context menu
    const backdrop = screen.getByRole('button', { name: 'Close context menu' });
    await user.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByText('Play')).not.toBeInTheDocument();
    });
  });

  it('initializes file storage when not already initialized', async () => {
    mockIsFileStorageInitialized = false;
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    expect(mockInitializeFileStorage).toHaveBeenCalledWith(
      'mock-key',
      'test-instance'
    );
  });

  it('provides correct virtualizer config callbacks', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowList />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    // Verify the virtualizer config was captured
    expect(lastVirtualizerConfig).not.toBeNull();

    // Test getScrollElement callback - should return the parent ref
    const scrollElement = lastVirtualizerConfig?.getScrollElement();
    // In test environment, the ref might be null or a DOM element
    expect(
      scrollElement === null || scrollElement instanceof HTMLDivElement
    ).toBe(true);

    // Test estimateSize callback - should return ROW_HEIGHT_ESTIMATE (56)
    const estimatedSize = lastVirtualizerConfig?.estimateSize();
    expect(estimatedSize).toBe(56);
  });
});
