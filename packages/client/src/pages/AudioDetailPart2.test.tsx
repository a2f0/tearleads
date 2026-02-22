import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { AudioDetail } from './AudioDetail';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the audio playlists sidebar
vi.mock('@tearleads/audio', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/audio')>(
      '@tearleads/audio'
    );
  return {
    ...actual,
    ALL_AUDIO_ID: '__all__',
    AudioPlaylistsSidebar: () => (
      <div data-testid="audio-playlists-sidebar">Playlists Sidebar</div>
    )
  };
});

// Mock the database
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
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
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock file-utils
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn();
vi.mock('@/lib/fileUtils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

// Mock audio metadata extraction
const mockExtractAudioMetadata = vi.fn();
vi.mock('@/lib/audioMetadata', () => ({
  extractAudioMetadata: (data: Uint8Array, mimeType: string) =>
    mockExtractAudioMetadata(data, mimeType)
}));

// Mock audio context
const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockUseAudio = vi.fn();
vi.mock('@/audio', () => ({
  useAudio: () => mockUseAudio()
}));

const TEST_AUDIO = {
  id: 'audio-123',
  name: 'test-audio.mp3',
  size: 2048,
  mimeType: 'audio/mpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/audio/test-audio.mp3'
};

const TEST_AUDIO_DATA = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // MP3 header bytes
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result)
      })
    })
  };
}

function renderAudioDetailRaw(audioId: string = 'audio-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/audio/${audioId}`]}>
        <Routes>
          <Route path="/audio/:id" element={<AudioDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function renderAudioDetail(audioId: string = 'audio-123') {
  const result = renderAudioDetailRaw(audioId);
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading audio...')).not.toBeInTheDocument();
  });
  return result;
}

describe('AudioDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for unlocked database with audio
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_AUDIO_DATA);
    mockExtractAudioMetadata.mockResolvedValue({
      title: 'Track Title',
      artist: 'Artist Name',
      album: 'Album Name',
      albumArtist: 'Album Artist Name',
      year: 2024,
      trackNumber: 2,
      trackTotal: 10,
      genre: ['Rock', 'Alt']
    });
    mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO]));
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    });
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
    mockUseAudio.mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume
    });
  });

  describe('share functionality', () => {
    it('shares file when share button is clicked', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/audio/test-audio.mp3',
          expect.any(Function)
        );
        expect(mockShareFile).toHaveBeenCalledWith(
          TEST_AUDIO_DATA,
          'test-audio.mp3',
          'audio/mpeg'
        );
      });
    });

    it('handles share cancellation gracefully', async () => {
      const abortError = new Error('User cancelled');
      abortError.name = 'AbortError';
      mockShareFile.mockRejectedValue(abortError);

      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      // Wait for the action to complete
      await waitFor(() => {
        expect(mockShareFile).toHaveBeenCalled();
      });

      // Should not show error for AbortError
      expect(screen.queryByText('User cancelled')).not.toBeInTheDocument();
    });

    it('shows error when share fails', async () => {
      const consoleSpy = mockConsoleError();
      mockShareFile.mockRejectedValue(new Error('Share failed'));
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to share audio:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when sharing is not supported on device', async () => {
      mockShareFile.mockResolvedValue(false);
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(
          screen.getByText('Sharing is not supported on this device')
        ).toBeInTheDocument();
      });
    });
  });

  describe('delete functionality', () => {
    it('navigates back to audio list after delete', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('delete-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/audio');
      });
    });

    it('shows error when delete fails', async () => {
      const consoleSpy = mockConsoleError();
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      });
      const user = userEvent.setup();
      await renderAudioDetail();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete audio:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('thumbnail loading', () => {
    it('shows album cover when thumbnail is available', async () => {
      const audioWithThumbnail = {
        ...TEST_AUDIO,
        thumbnailPath: '/audio/thumb.jpg'
      };
      mockSelect.mockReturnValue(createMockQueryChain([audioWithThumbnail]));
      mockRetrieve
        .mockResolvedValueOnce(TEST_AUDIO_DATA)
        .mockResolvedValueOnce(new Uint8Array([0x01, 0x02]));

      await renderAudioDetail();

      expect(await screen.findByAltText('Album cover')).toBeInTheDocument();
    });

    it('falls back when thumbnail loading fails', async () => {
      const audioWithThumbnail = {
        ...TEST_AUDIO,
        thumbnailPath: '/audio/thumb.jpg'
      };
      mockSelect.mockReturnValue(createMockQueryChain([audioWithThumbnail]));
      mockRetrieve
        .mockResolvedValueOnce(TEST_AUDIO_DATA)
        .mockRejectedValueOnce(new Error('Thumbnail failed'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await renderAudioDetail();

      await waitFor(() => {
        expect(screen.getByText('Audio Details')).toBeInTheDocument();
      });
      expect(screen.queryByAltText('Album cover')).not.toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load thumbnail:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('audio not found', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows not found error', async () => {
      await renderAudioDetail();

      expect(screen.getByText('Audio file not found')).toBeInTheDocument();
    });
  });

  describe('back navigation', () => {
    it('renders back link to audio page', async () => {
      await renderAudioDetail();

      const backLink = screen.getByText('Back');
      expect(backLink).toBeInTheDocument();
      expect(backLink.closest('a')).toHaveAttribute('href', '/audio');
    });
  });

  describe('name editing', () => {
    it('renders edit button for audio name', async () => {
      await renderAudioDetail();

      expect(screen.getByTestId('audio-title-edit')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      await user.click(screen.getByTestId('audio-title-edit'));

      expect(screen.getByTestId('audio-title-input')).toBeInTheDocument();
      expect(screen.getByTestId('audio-title-input')).toHaveValue(
        'test-audio.mp3'
      );
    });

    it('updates audio name when saved', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      await user.click(screen.getByTestId('audio-title-edit'));
      await user.clear(screen.getByTestId('audio-title-input'));
      await user.type(screen.getByTestId('audio-title-input'), 'new-name.mp3');
      await user.click(screen.getByTestId('audio-title-save'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('cancels edit mode when cancel button is clicked', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      await user.click(screen.getByTestId('audio-title-edit'));
      await user.clear(screen.getByTestId('audio-title-input'));
      await user.type(screen.getByTestId('audio-title-input'), 'new-name.mp3');
      await user.click(screen.getByTestId('audio-title-cancel'));

      expect(screen.queryByTestId('audio-title-input')).not.toBeInTheDocument();
      expect(screen.getByText('test-audio.mp3')).toBeInTheDocument();
    });
  });
});
