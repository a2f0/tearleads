/**
 * Audio page playback tests - covers audio context integration and playback controls.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Get the mocked detectPlatform for test manipulation
import { detectPlatform as mockDetectPlatformFn } from '@/lib/utils';
import { mockConsoleError } from '@/test/consoleMocks';
import { AudioPage } from './Audio';
import {
  createMockQueryChain,
  mockGetCurrentKey,
  mockInitializeFileStorage,
  mockInsertValues,
  mockIsFileStorageInitialized,
  mockPause,
  mockPlay,
  mockResume,
  mockRetrieve,
  mockSelect,
  mockUpdate,
  mockUploadFile,
  mockUseAudio,
  mockUseDatabaseContext,
  setupDefaultMocks,
  TEST_AUDIO_TRACK
} from './Audio.testSetup';

const mockDetectPlatform = mockDetectPlatformFn as ReturnType<typeof vi.fn>;

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  }))
}));

// Mock AudioPlaylistsSidebar from @tearleads/audio
vi.mock('@tearleads/audio', () => ({
  ALL_AUDIO_ID: '__all__',
  AudioPlaylistsSidebar: vi.fn(
    ({
      selectedPlaylistId,
      onPlaylistSelect,
      onPlaylistChanged,
      onDropToPlaylist,
      onWidthChange,
      width
    }) => (
      <div data-testid="audio-playlists-sidebar">
        <span data-testid="selected-playlist">{selectedPlaylistId}</span>
        <span data-testid="sidebar-width">{width}</span>
        <button
          type="button"
          data-testid="select-playlist-1"
          onClick={() => onPlaylistSelect('playlist-1')}
        >
          Select Playlist 1
        </button>
        <button
          type="button"
          data-testid="trigger-playlist-changed"
          onClick={() => onPlaylistChanged?.()}
        >
          Trigger Playlist Changed
        </button>
        <button
          type="button"
          data-testid="change-width"
          onClick={() => onWidthChange?.(300)}
        >
          Change Width
        </button>
        <button
          type="button"
          data-testid="drop-to-playlist"
          onClick={() =>
            onDropToPlaylist?.('playlist-1', [], ['track-1', 'track-2'])
          }
        >
          Drop To Playlist
        </button>
      </div>
    )
  )
}));

// Mock ClientAudioProvider
vi.mock('@/contexts/ClientAudioProvider', () => ({
  ClientAudioProvider: vi.fn(({ children }) => (
    <div data-testid="client-audio-provider">{children}</div>
  ))
}));

// Mock the audio context
vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio(),
  useAudioAnalyser: () => new Uint8Array(12)
}));

// Mock the audio visualizer component to avoid Web Audio API in tests
vi.mock('@/components/audio/AudioVisualizer', () => ({
  AudioVisualizer: () => null
}));

// Mock the database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(() => ({ values: mockInsertValues }))
  })
}));

// Mock navigation
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', state: null })
  };
});

// Mock the key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve,
    store: vi.fn()
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock useFileUpload hook
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

// Mock detectPlatform to return 'web' by default (supports drag and drop)
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: vi.fn(() => 'web')
  };
});

function renderAudio() {
  return render(
    <MemoryRouter>
      <AudioPage />
    </MemoryRouter>
  );
}

describe('AudioPage - audio context integration', () => {
  let consoleSpy: ReturnType<typeof mockConsoleError> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    mockDetectPlatform.mockReturnValue('web');
    consoleSpy = mockConsoleError();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
  });

  afterEach(() => {
    if (consoleSpy) {
      const allowedErrors = [
        'The current testing environment is not configured to support act(...)'
      ];
      const unexpectedErrors = consoleSpy.mock.calls.filter((call) => {
        const firstArg = call[0];
        const message =
          typeof firstArg === 'string'
            ? firstArg
            : firstArg instanceof Error
              ? firstArg.message
              : '';
        return !allowedErrors.some((allowed) => message.includes(allowed));
      });

      expect(unexpectedErrors).toEqual([]);
      consoleSpy.mockRestore();
      consoleSpy = null;
    }
  });

  it('calls play when track is double-clicked on web/electron', async () => {
    mockDetectPlatform.mockReturnValue('web');
    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.dblClick(screen.getByTestId('audio-play-track-1'));

    expect(mockPlay).toHaveBeenCalledWith({
      id: 'track-1',
      name: 'test-song.mp3',
      objectUrl: 'blob:test-url',
      mimeType: 'audio/mpeg'
    });
  });

  it('calls play when track is single-clicked on iOS', async () => {
    mockDetectPlatform.mockReturnValue('ios');
    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('audio-play-track-1'));

    expect(mockPlay).toHaveBeenCalledWith({
      id: 'track-1',
      name: 'test-song.mp3',
      objectUrl: 'blob:test-url',
      mimeType: 'audio/mpeg'
    });
  });

  it('calls play when track is single-clicked on Android', async () => {
    mockDetectPlatform.mockReturnValue('android');
    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('audio-play-track-1'));

    expect(mockPlay).toHaveBeenCalledWith({
      id: 'track-1',
      name: 'test-song.mp3',
      objectUrl: 'blob:test-url',
      mimeType: 'audio/mpeg'
    });
  });

  it('does not play on single click for web/electron', async () => {
    mockDetectPlatform.mockReturnValue('web');
    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('audio-play-track-1'));

    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('calls pause when track is double-clicked on playing track (web)', async () => {
    mockDetectPlatform.mockReturnValue('web');
    mockUseAudio.mockReturnValue({
      currentTrack: {
        id: 'track-1',
        name: 'test-song.mp3',
        objectUrl: 'blob:test-url',
        mimeType: 'audio/mpeg'
      },
      isPlaying: true,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume,
      audioElementRef: { current: null }
    });

    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.dblClick(screen.getByTestId('audio-play-track-1'));

    expect(mockPause).toHaveBeenCalled();
  });

  it('calls resume when track is double-clicked on paused track (web)', async () => {
    mockDetectPlatform.mockReturnValue('web');
    mockUseAudio.mockReturnValue({
      currentTrack: {
        id: 'track-1',
        name: 'test-song.mp3',
        objectUrl: 'blob:test-url',
        mimeType: 'audio/mpeg'
      },
      isPlaying: false,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume,
      audioElementRef: { current: null }
    });

    const user = userEvent.setup();
    renderAudio();

    await waitFor(() => {
      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
    });

    await user.dblClick(screen.getByTestId('audio-play-track-1'));

    expect(mockResume).toHaveBeenCalled();
  });

  it('highlights the currently playing track', async () => {
    mockUseAudio.mockReturnValue({
      currentTrack: {
        id: 'track-1',
        name: 'test-song.mp3',
        objectUrl: 'blob:test-url',
        mimeType: 'audio/mpeg'
      },
      isPlaying: true,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume,
      audioElementRef: { current: null }
    });

    renderAudio();

    await waitFor(() => {
      const trackElement = screen.getByTestId('audio-track-track-1');
      expect(trackElement).toHaveClass('border-primary');
    });
  });
});
