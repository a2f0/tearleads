import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPage } from './Audio';

// Mock the audio context
const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockUseAudio = vi.fn();
vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

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
    measureRetrieve: mockRetrieve,
    store: mockStore
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
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

function renderAudioRaw() {
  return render(
    <MemoryRouter>
      <AudioPage />
    </MemoryRouter>
  );
}

async function renderAudio() {
  const result = renderAudioRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading audio...')).not.toBeInTheDocument();
  });
  return result;
}

describe('AudioPage', () => {
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
      resume: mockResume
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
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderAudio();

      expect(screen.getByText('Audio')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      await renderAudio();

      expect(screen.getByText('Refresh')).toBeInTheDocument();
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

      expect(screen.queryByText('Refresh')).not.toBeInTheDocument();
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
      await renderAudio();

      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      expect(screen.getByText('another-song.wav')).toBeInTheDocument();
    });

    it('displays track sizes', async () => {
      await renderAudio();

      expect(screen.getByText('5 MB')).toBeInTheDocument();
      expect(screen.getByText('10 MB')).toBeInTheDocument();
    });

    it('renders play buttons for tracks', async () => {
      await renderAudio();

      const playButtons = screen.getAllByRole('button', { name: /play/i });
      expect(playButtons.length).toBeGreaterThan(0);
    });

    it('fetches audio data from storage', async () => {
      await renderAudio();

      expect(mockRetrieve).toHaveBeenCalledWith(
        '/music/test-song.mp3',
        expect.any(Function)
      );
      expect(mockRetrieve).toHaveBeenCalledWith(
        '/music/another-song.wav',
        expect.any(Function)
      );
    });

    it('creates object URLs for audio playback', async () => {
      await renderAudio();

      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('revokes object URLs on unmount', async () => {
      const { unmount } = await renderAudio();

      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();

      await act(async () => {
        unmount();
      });

      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows dropzone when no tracks', async () => {
      await renderAudio();

      expect(
        screen.getByText('Drop an audio file here to add it to your library')
      ).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching tracks', () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
          })
        })
      });

      renderAudioRaw();

      expect(screen.getByText('Loading audio...')).toBeInTheDocument();
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

      renderAudioRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });

    it('handles track load failure gracefully', async () => {
      mockRetrieve.mockRejectedValue(new Error('Storage error'));

      renderAudioRaw();

      // Should not crash, but track won't be displayed
      await waitFor(() => {
        expect(screen.queryByText('test-song.mp3')).not.toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refreshes track list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderAudio();

      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();

      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });

    it('disables Refresh button while loading', () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => new Promise(() => {}))
          })
        })
      });

      renderAudioRaw();

      expect(screen.getByText('Loading audio...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
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

  describe('file upload', () => {
    let user: ReturnType<typeof userEvent.setup>;
    const audioFile = new File(['audio content'], 'test.mp3', {
      type: 'audio/mpeg'
    });
    let input: HTMLElement;

    beforeEach(async () => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
      user = userEvent.setup();
      await renderAudio();

      expect(
        screen.getByText('Drop an audio file here to add it to your library')
      ).toBeInTheDocument();

      input = screen.getByTestId('dropzone-input');
    });

    it('uploads valid audio file when dropped', async () => {
      await user.upload(input as HTMLInputElement, audioFile);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'test.mp3' }),
          expect.any(Function)
        );
      });
    });

    it('refreshes tracks after successful upload', async () => {
      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));

      await user.upload(input as HTMLInputElement, audioFile);

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });

    it('handles upload error gracefully', async () => {
      mockUploadFile.mockRejectedValue(new Error('Upload failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await user.upload(input as HTMLInputElement, audioFile);

      await waitFor(() => {
        expect(screen.getByText('Upload failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('audio context integration', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
    });

    it('calls play when play button is clicked', async () => {
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

    it('calls pause when pause button is clicked on playing track', async () => {
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
        resume: mockResume
      });

      const user = userEvent.setup();
      renderAudio();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('audio-play-track-1'));

      expect(mockPause).toHaveBeenCalled();
    });

    it('calls resume when play button is clicked on paused track', async () => {
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
        resume: mockResume
      });

      const user = userEvent.setup();
      renderAudio();

      await waitFor(() => {
        expect(screen.getByText('test-song.mp3')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('audio-play-track-1'));

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
        resume: mockResume
      });

      renderAudio();

      await waitFor(() => {
        const trackElement = screen.getByTestId('audio-track-track-1');
        expect(trackElement).toHaveClass('border-primary');
      });
    });
  });
});
