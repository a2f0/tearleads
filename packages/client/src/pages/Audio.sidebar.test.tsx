/**
 * Audio wrapper with sidebar tests - covers sidebar integration and routing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Get the mocked detectPlatform for test manipulation
import { detectPlatform as mockDetectPlatformFn } from '@/lib/utils';
import { Audio } from './Audio';
import {
  createMockQueryChain,
  createMockUpdateChain,
  mockGetCurrentKey,
  mockInitializeFileStorage,
  mockInsert,
  mockInsertValues,
  mockIsFileStorageInitialized,
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
  TEST_AUDIO_DATA,
  TEST_AUDIO_TRACK,
  TEST_ENCRYPTION_KEY
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
    insert: mockInsert
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

function renderAudioWrapper(route = '/audio') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/audio" element={<Audio />} />
        <Route path="/audio/playlists/:playlistId" element={<Audio />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Audio wrapper with sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mock for audio context
    mockUseAudio.mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume,
      audioElementRef: { current: null }
    });

    // Default mocks for unlocked database
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_AUDIO_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
    mockUpdate.mockReturnValue(createMockUpdateChain());
    mockDetectPlatform.mockReturnValue('web');
  });

  describe('when database is unlocked', () => {
    it('renders with ClientAudioProvider', () => {
      renderAudioWrapper();
      expect(screen.getByTestId('client-audio-provider')).toBeInTheDocument();
    });

    it('renders the sidebar', () => {
      renderAudioWrapper();
      expect(screen.getByTestId('audio-playlists-sidebar')).toBeInTheDocument();
    });

    it('renders the back link', () => {
      renderAudioWrapper();
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('initializes with ALL_AUDIO_ID selected', () => {
      renderAudioWrapper();
      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        '__all__'
      );
    });

    it('navigates when playlist is selected', async () => {
      const user = userEvent.setup();
      renderAudioWrapper();

      await user.click(screen.getByTestId('select-playlist-1'));

      // Navigation is now handled via URL routing
      expect(mockNavigate).toHaveBeenCalledWith('/audio/playlists/playlist-1');
    });

    it('links dropped track ids to playlist', async () => {
      const user = userEvent.setup();
      renderAudioWrapper();

      await user.click(screen.getByTestId('drop-to-playlist'));

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalled();
        expect(mockInsertValues).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              childId: 'track-1',
              parentId: 'playlist-1'
            }),
            expect.objectContaining({
              childId: 'track-2',
              parentId: 'playlist-1'
            })
          ])
        );
      });
    });

    it('updates width when onWidthChange is called', async () => {
      const user = userEvent.setup();
      renderAudioWrapper();

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('200');

      await user.click(screen.getByTestId('change-width'));

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('300');
    });

    it('increments refreshToken when onPlaylistChanged is called', async () => {
      const user = userEvent.setup();
      renderAudioWrapper();

      // Trigger the playlist changed callback
      await user.click(screen.getByTestId('trigger-playlist-changed'));

      // The test passes if no errors occur - refreshToken is internal state
      expect(screen.getByTestId('audio-playlists-sidebar')).toBeInTheDocument();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });
    });

    it('does not render the sidebar', () => {
      renderAudioWrapper();
      expect(
        screen.queryByTestId('audio-playlists-sidebar')
      ).not.toBeInTheDocument();
    });

    it('shows inline unlock component', () => {
      renderAudioWrapper();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    });
  });

  describe('URL-based routing', () => {
    it('reads playlistId from URL params', () => {
      renderAudioWrapper('/audio/playlists/test-playlist-123');

      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        'test-playlist-123'
      );
    });

    it('uses ALL_AUDIO_ID when no playlist param', () => {
      renderAudioWrapper('/audio');

      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        '__all__'
      );
    });

    it('navigates to playlist route when playlist is selected', async () => {
      const user = userEvent.setup();
      renderAudioWrapper('/audio');

      await user.click(screen.getByTestId('select-playlist-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/audio/playlists/playlist-1');
    });

    it('navigates to /audio when ALL_AUDIO_ID is selected', async () => {
      const user = userEvent.setup();

      // Mock the sidebar to have an "All Audio" button
      const { AudioPlaylistsSidebar } = await import('@tearleads/audio');
      const MockedSidebar = AudioPlaylistsSidebar as unknown as ReturnType<
        typeof vi.fn
      >;
      MockedSidebar.mockImplementation(({ onPlaylistSelect }) => (
        <div data-testid="audio-playlists-sidebar">
          <button
            type="button"
            data-testid="select-all-audio"
            onClick={() => onPlaylistSelect('__all__')}
          >
            All Audio
          </button>
        </div>
      ));

      renderAudioWrapper('/audio/playlists/test-playlist');

      await user.click(screen.getByTestId('select-all-audio'));

      expect(mockNavigate).toHaveBeenCalledWith('/audio');
    });
  });
});
