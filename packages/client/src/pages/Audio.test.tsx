import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { AudioPage } from './Audio';

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

// Mock the audio context
const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockUseAudio = vi.fn();
vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

// Mock the audio visualizer component to avoid Web Audio API in tests
vi.mock('@/components/audio/AudioVisualizer', () => ({
  AudioVisualizer: () => null
}));

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

// Mock navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/', state: null })
  };
});

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

// Mock detectPlatform to return 'web' by default (supports drag and drop)
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: vi.fn(() => 'web')
  };
});

// Get the mocked detectPlatform for test manipulation
import { detectPlatform as mockDetectPlatformFn } from '@/lib/utils';

const mockDetectPlatform = mockDetectPlatformFn as ReturnType<typeof vi.fn>;

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

function createMockUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined)
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
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
    mockDetectPlatform.mockReturnValue('web');
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderAudio();

      expect(screen.getByText('Audio')).toBeInTheDocument();
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

    it('shows track count', async () => {
      await renderAudio();

      expect(screen.getByText(/2 tracks$/)).toBeInTheDocument();
    });

    it('renders play buttons for tracks', async () => {
      await renderAudio();

      // The card area itself is now the play button
      expect(screen.getByTestId('audio-play-track-1')).toBeInTheDocument();
      expect(screen.getByTestId('audio-play-track-2')).toBeInTheDocument();
    });

    it('renders detail navigation buttons for tracks', async () => {
      await renderAudio();

      const detailButtons = screen.getAllByRole('button', {
        name: /view details/i
      });
      expect(detailButtons).toHaveLength(2);
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

      expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    });

    const hintText = 'Drop an audio file here to add it to your library';

    it.each([
      'web',
      'electron'
    ])('shows drag and drop hint on %s', async (platform) => {
      mockDetectPlatform.mockReturnValue(platform);
      await renderAudio();
      expect(screen.getByText(hintText)).toBeInTheDocument();
    });

    it.each([
      'ios',
      'android'
    ])('hides drag and drop hint on %s', async (platform) => {
      mockDetectPlatform.mockReturnValue(platform);
      await renderAudio();
      expect(screen.queryByText(hintText)).not.toBeInTheDocument();
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

  describe('refresh functionality', () => {
    it('refreshes track list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderAudio();

      expect(screen.getByText('test-song.mp3')).toBeInTheDocument();

      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

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

      renderAudioRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

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
      mockDetectPlatform.mockReturnValue('web');
      user = userEvent.setup();
      await renderAudio();

      expect(screen.getByTestId('dropzone')).toBeInTheDocument();

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

      // Flush the setTimeout used for instance-aware fetching after upload triggers hasFetched = false
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

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

  describe('context menu', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_TRACK]));
    });

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

    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      await renderAudio();

      await openContextMenuOnTrack(user, 'track-1');

      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
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
