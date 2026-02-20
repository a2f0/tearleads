/**
 * Audio page rendering tests - covers page rendering, loading states, and locked state.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { AudioPage } from './Audio';
import {
  mockGetCurrentKey,
  mockInitializeFileStorage,
  mockInsertValues,
  mockIsFileStorageInitialized,
  mockRetrieve,
  mockSelect,
  mockUpdate,
  mockUploadFile,
  mockUseAudio,
  mockUseDatabaseContext,
  setupDefaultMocks,
  TEST_ENCRYPTION_KEY
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

describe('AudioPage - rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderAudio();

      expect(screen.getByText('Audio')).toBeInTheDocument();
    });

    it('shows back link by default', async () => {
      await renderAudio();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      await renderAudio();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });
    });

    it('shows loading message', () => {
      renderAudioRaw();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderAudioRaw();

      expect(
        screen.queryByRole('button', { name: 'Refresh' })
      ).not.toBeInTheDocument();
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

    it('shows inline unlock component', () => {
      renderAudioRaw();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view audio./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderAudioRaw();

      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderAudioRaw();

      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderAudioRaw();

      expect(
        screen.queryByRole('button', { name: 'Refresh' })
      ).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching tracks', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
          })
        })
      });

      renderAudioRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Loading audio...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
          })
        })
      });

      renderAudioRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch tracks:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles track load failure gracefully', async () => {
      const consoleSpy = mockConsoleError();
      mockRetrieve.mockRejectedValue(new Error('Storage error'));

      renderAudioRaw();

      // Should not crash, but track won't be displayed
      await waitFor(() => {
        expect(screen.queryByText('test-song.mp3')).not.toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load track test-song.mp3:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('file storage initialization', () => {
    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);

      await renderAudio();

      expect(mockInitializeFileStorage).toHaveBeenCalledWith(
        TEST_ENCRYPTION_KEY
      );
    });
  });

  describe('instance switching', () => {
    it('refetches tracks when instance changes', async () => {
      const { rerender } = await renderAudio();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      });

      // Clear mocks to track new calls
      mockSelect.mockClear();

      // Change the instance
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'new-instance'
      });

      // Re-render with the new instance context
      rerender(
        <MemoryRouter>
          <AudioPage />
        </MemoryRouter>
      );

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify that tracks were fetched again
      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });
  });
});
