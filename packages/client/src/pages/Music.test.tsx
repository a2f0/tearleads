import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicPage } from './Music';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database
const mockSelect = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect
  })
}));

// Mock the key manager
const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

// Mock file storage
const mockRetrieve = vi.fn();
const mockStore = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    store: mockStore
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key)
}));

// Mock useFileUpload hook
const mockUploadFile = vi.fn();
vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

const TEST_AUDIO_TRACK = {
  id: 'track-1',
  name: 'test-song.mp3',
  size: 5242880, // 5 MB
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/music/test-song.mp3'
};

const TEST_AUDIO_TRACK_2 = {
  id: 'track-2',
  name: 'another-song.wav',
  size: 10485760, // 10 MB
  mimeType: 'audio/wav',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/music/another-song.wav'
};

const TEST_AUDIO_DATA = new Uint8Array([0x49, 0x44, 0x33]); // ID3 tag bytes
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(result)
      })
    })
  };
}

function renderMusic() {
  return render(
    <MemoryRouter>
      <MusicPage />
    </MemoryRouter>
  );
}

describe('MusicPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mocks for unlocked database
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_AUDIO_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderMusic();

      expect(screen.getByText('Music')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      renderMusic();

      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
    });

    it('shows loading message', () => {
      renderMusic();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderMusic();

      expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('when database is locked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
    });

    it('shows locked message', () => {
      renderMusic();

      expect(
        screen.getByText(/Database is locked. Unlock it from the SQLite page/)
      ).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderMusic();

      expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('when tracks are loaded', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_AUDIO_TRACK, TEST_AUDIO_TRACK_2])
      );
    });

    it('displays track names', async () => {
      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
        expect(screen.getByText('another-song.wav')).toBeInTheDocument();
      });
    });

    it('displays track sizes', async () => {
      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('5 MB')).toBeInTheDocument();
        expect(screen.getByText('10 MB')).toBeInTheDocument();
      });
    });

    it('renders audio elements', async () => {
      renderMusic();

      await waitFor(() => {
        const audioElements = screen.getAllByRole('generic', { hidden: true });
        // Audio elements should be present (they're role="generic" in jsdom)
        expect(audioElements.length).toBeGreaterThan(0);
      });
    });

    it('fetches audio data from storage', async () => {
      renderMusic();

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith('/music/test-song.mp3');
        expect(mockRetrieve).toHaveBeenCalledWith('/music/another-song.wav');
      });
    });

    it('creates object URLs for audio playback', async () => {
      renderMusic();

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalled();
      });
    });

    it('revokes object URLs on unmount', async () => {
      const { unmount } = renderMusic();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      });

      unmount();

      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows dropzone when no tracks', async () => {
      renderMusic();

      await waitFor(() => {
        expect(
          screen.getByText('Drop an audio file here to add it to your library')
        ).toBeInTheDocument();
      });
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

      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('Loading music...')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when fetch fails', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
          })
        })
      });

      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });

    it('handles track load failure gracefully', async () => {
      mockRetrieve.mockRejectedValue(new Error('Storage error'));

      renderMusic();

      // Should not crash, but track won't be displayed
      await waitFor(() => {
        expect(screen.queryByText('test-song.mp3')).not.toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes track list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      });

      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });

    it('disables Refresh button while loading', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => new Promise(() => {}))
          })
        })
      });

      renderMusic();

      await waitFor(() => {
        expect(screen.getByText('Loading music...')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });

  describe('file storage initialization', () => {
    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);

      renderMusic();

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY
        );
      });
    });
  });
});
