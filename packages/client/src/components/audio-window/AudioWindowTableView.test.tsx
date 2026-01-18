import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioWindowTableView } from './AudioWindowTableView';

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
    uploadDate: new Date('2024-01-15T10:30:00'),
    storagePath: '/audio/track-1',
    thumbnailPath: null
  },
  {
    id: 'track-2',
    name: 'Song Two.mp3',
    size: 3000000,
    mimeType: 'audio/wav',
    uploadDate: new Date('2024-01-20T14:45:00'),
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

const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();

describe('AudioWindowTableView', () => {
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

    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  it('shows database loading state', () => {
    mockDatabaseState.isLoading = true;
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowTableView />);
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    mockDatabaseState.isLoading = false;
    render(<AudioWindowTableView />);
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders container element', () => {
    const { container } = render(<AudioWindowTableView />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders header with Audio title', () => {
    render(<AudioWindowTableView />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    render(<AudioWindowTableView />);
    expect(
      screen.getByRole('button', { name: /refresh/i })
    ).toBeInTheDocument();
  });

  it('shows empty state when no tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('No audio files')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Upload audio from the main Audio page')
    ).toBeInTheDocument();
  });

  it('renders table view with sortable column headers', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Type/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Date/i })).toBeInTheDocument();
  });

  it('renders tracks in table rows', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
  });

  it('displays file size in table', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    expect(screen.getByText('4.77 MB')).toBeInTheDocument();
  });

  it('displays file type in table', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    expect(screen.getByText('MP3')).toBeInTheDocument();
    expect(screen.getByText('WAV')).toBeInTheDocument();
  });

  it('displays upload date in table', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });
    // Date is formatted with formatDate; check for date components to be locale-agnostic
    expect(screen.getByText(/15.*2024|2024.*15/)).toBeInTheDocument();
  });

  it('renders search input when tracks exist', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(
        screen.getByTestId('window-audio-table-search')
      ).toBeInTheDocument();
    });
  });

  it('filters tracks by search query', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-table-search');
    await user.type(searchInput, 'Two');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockDb.orderBy.mockRejectedValue(new Error('Database error'));
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('sorts by name column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Name/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('toggles sort direction when clicking same column', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    // Click Date column (which is the default sort column)
    await user.click(screen.getByRole('button', { name: /Date/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('sorts by size column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Size/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('sorts by type column when clicked', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Type/i }));

    await waitFor(() => {
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  it('shows context menu on right click', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get Info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('plays track via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

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
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

    await waitFor(() => {
      expect(screen.getByText('Pause')).toBeInTheDocument();
    });
  });

  it('deletes track via context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

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
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

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
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    });
  });

  it('highlights currently playing track row', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    render(<AudioWindowTableView />);

    await waitFor(() => {
      const trackRow = screen.getByTestId('window-audio-table-track-track-1');
      expect(trackRow).toHaveClass('bg-primary/5');
    });
  });

  it('pauses track when clicking pause from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

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
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Play'));
    expect(mockAudioState.resume).toHaveBeenCalled();
  });

  it('refreshes tracks when refresh button is clicked', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

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
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });

    const images = document.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
  });

  it('handles double-click to play on desktop', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.dblClick(trackRow);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('handles single-click to play on mobile platform', async () => {
    mockPlatform = 'ios';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.click(trackRow);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('opens info page from context menu', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const onSelectTrack = vi.fn();

    const user = userEvent.setup();
    render(<AudioWindowTableView onSelectTrack={onSelectTrack} />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

    await waitFor(() => {
      expect(screen.getByText('Get Info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get Info'));
    expect(onSelectTrack).toHaveBeenCalledWith('track-1');
  });

  it('shows no results when search has no matches', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-table-search');
    await user.type(searchInput, 'nonexistent track');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.queryByText('Song Two.mp3')).not.toBeInTheDocument();
  });

  it('case-insensitive search works correctly', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-table-search');
    await user.type(searchInput, 'SONG ONE');

    expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    expect(screen.queryByText('Song Two.mp3')).not.toBeInTheDocument();
  });

  it('revokes object URLs on unmount', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);

    const { unmount } = render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    unmount();

    expect(mockRevokeObjectURL).toHaveBeenCalled();
  });

  it('closes context menu when clicking backdrop', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.pointer({ keys: '[MouseRight]', target: trackRow });

    await waitFor(() => {
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    const backdrop = screen.getByRole('button', { name: 'Close context menu' });
    await user.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByText('Play')).not.toBeInTheDocument();
    });
  });

  it('initializes file storage when not already initialized', async () => {
    mockIsFileStorageInitialized = false;
    mockDb.orderBy.mockResolvedValue(mockTracks);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    expect(mockInitializeFileStorage).toHaveBeenCalledWith(
      'mock-key',
      'test-instance'
    );
  });

  it('does not render action buttons when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowTableView />);

    expect(
      screen.queryByRole('button', { name: /refresh/i })
    ).not.toBeInTheDocument();
  });

  it('does not fetch when database is locked', () => {
    mockDatabaseState.isUnlocked = false;
    render(<AudioWindowTableView />);

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('handles search query clearing', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('window-audio-table-search');
    await user.type(searchInput, 'Two');

    expect(screen.queryByText('Song One.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();

    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
      expect(screen.getByText('Song Two.mp3')).toBeInTheDocument();
    });
  });

  it('handles android platform as mobile', async () => {
    mockPlatform = 'android';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.click(trackRow);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('handles electron platform as desktop', async () => {
    mockPlatform = 'electron';
    mockDb.orderBy.mockResolvedValue(mockTracks);
    const user = userEvent.setup();
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    await user.dblClick(trackRow);

    expect(mockAudioState.play).toHaveBeenCalled();
  });

  it('shows playing indicator on current track in table', async () => {
    mockDb.orderBy.mockResolvedValue(mockTracks);
    mockAudioState.currentTrack = { id: 'track-1', name: 'Song One.mp3' };
    mockAudioState.isPlaying = true;

    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('Song One.mp3')).toBeInTheDocument();
    });

    const trackRow = screen.getByTestId('window-audio-table-track-track-1');
    const playingIndicator = trackRow.querySelector('.bg-primary');
    expect(playingIndicator).toBeInTheDocument();
  });

  it('handles unknown audio mime type', async () => {
    const tracksWithUnknownType = [
      {
        ...mockTracks[0],
        mimeType: 'audio/x-unknown'
      }
    ];
    mockDb.orderBy.mockResolvedValue(tracksWithUnknownType);
    render(<AudioWindowTableView />);

    await waitFor(() => {
      expect(screen.getByText('X-UNKNOWN')).toBeInTheDocument();
    });
  });
});
