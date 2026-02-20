/**
 * Audio page context menu tests - covers right-click menu operations.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPage } from './Audio';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockGetCurrentKey,
  mockInsertValues,
  mockIsFileStorageInitialized,
  mockInitializeFileStorage,
  mockNavigate,
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
    useNavigate: () => mockNavigate,
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

function renderAudioRaw() {
  return render(
    <MemoryRouter>
      <AudioPage />
    </MemoryRouter>
  );
}

async function renderAudio() {
  const result = renderAudioRaw();
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading audio...')).not.toBeInTheDocument();
  });
  return result;
}

async function openContextMenuOnTrack(
  user: ReturnType<typeof userEvent.setup>,
  trackId: string
) {
  const trackRow = screen.getByTestId(`audio-track-${trackId}`);
  await user.pointer({ keys: '[MouseRight]', target: trackRow });
  await waitFor(() => {
    expect(screen.getByText('Get info')).toBeInTheDocument();
  });
}

describe('AudioPage - context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
  });

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByText('Get info')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('plays track when "Play" is clicked from context menu', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    await user.click(screen.getByText('Play'));

    expect(mockPlay).toHaveBeenCalledWith({
      id: 'track-1',
      name: 'test-song.mp3',
      objectUrl: 'blob:test-url',
      mimeType: 'audio/mpeg'
    });

    // Context menu should be closed
    await waitFor(() => {
      expect(screen.queryByText('Play')).not.toBeInTheDocument();
    });
  });

  it('pauses track when "Pause" is clicked on currently playing track', async () => {
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
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    expect(screen.getByText('Pause')).toBeInTheDocument();
    await user.click(screen.getByText('Pause'));

    expect(mockPause).toHaveBeenCalled();
  });

  it('resumes track when "Play" is clicked on paused track', async () => {
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
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    await user.click(screen.getByText('Play'));

    expect(mockResume).toHaveBeenCalled();
  });

  it('navigates to audio detail when "Get info" is clicked', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    await user.click(screen.getByText('Get info'));

    expect(mockNavigate).toHaveBeenCalledWith('/audio/track-1', {
      state: { from: '/', fromLabel: 'Back to Audio' }
    });
  });

  it('deletes track and removes from list when "Delete" is clicked', async () => {
    const user = userEvent.setup();
    await renderAudio();

    expect(screen.getByText('test-song.mp3')).toBeInTheDocument();

    await openContextMenuOnTrack(user, 'track-1');

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
      expect(screen.queryByText('test-song.mp3')).not.toBeInTheDocument();
    });
  });

  it('revokes object URLs when deleting a track', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    await user.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });

  it('closes context menu when clicking elsewhere', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    // Click the backdrop
    await user.click(
      screen.getByRole('button', { name: /close context menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });

  it('closes context menu when pressing Escape', async () => {
    const user = userEvent.setup();
    await renderAudio();

    await openContextMenuOnTrack(user, 'track-1');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Get info')).not.toBeInTheDocument();
    });
  });
});
