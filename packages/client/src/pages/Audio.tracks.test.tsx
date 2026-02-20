/**
 * Audio page tracks tests - covers track loading, display, refresh, and file upload.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Get the mocked detectPlatform for test manipulation
import { detectPlatform as mockDetectPlatformFn } from '@/lib/utils';
import { AudioPage } from './Audio';
import {
  createMockQueryChain,
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
  TEST_AUDIO_TRACK,
  TEST_AUDIO_TRACK_2
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

describe('AudioPage - tracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    mockDetectPlatform.mockReturnValue('web');
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

    it('shows upload progress while uploading', async () => {
      let progressCallback: (progress: number) => void = () => {};
      const uploadControl = { resolve: () => {} };

      mockUploadFile.mockImplementation((_file, onProgress) => {
        progressCallback = onProgress ?? (() => {});
        return new Promise<void>((resolve) => {
          uploadControl.resolve = resolve;
        });
      });

      await user.upload(input as HTMLInputElement, audioFile);

      act(() => {
        progressCallback(37);
      });

      const progressbar = screen.getByRole('progressbar', {
        name: /upload progress/i
      });
      expect(progressbar).toHaveAttribute('aria-valuenow', '37');
      expect(screen.getByText('37%')).toBeInTheDocument();

      uploadControl.resolve();

      await waitFor(() => {
        expect(
          screen.queryByRole('progressbar', { name: /upload progress/i })
        ).not.toBeInTheDocument();
      });
    });
  });
});
