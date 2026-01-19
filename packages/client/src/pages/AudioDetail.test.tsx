import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
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
vi.mock('@/lib/file-utils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

// Mock audio metadata extraction
const mockExtractAudioMetadata = vi.fn();
vi.mock('@/lib/audio-metadata', () => ({
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

  describe('when database is loading', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });
    });

    it('shows loading message', () => {
      renderAudioDetailRaw();
      expect(screen.getByText('Loading database...')).toBeInTheDocument();
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
      renderAudioDetailRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this audio file./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderAudioDetailRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderAudioDetailRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when audio is loaded', () => {
    it('renders audio name', async () => {
      await renderAudioDetail();

      expect(screen.getByText('test-audio.mp3')).toBeInTheDocument();
    });

    it('renders audio details', async () => {
      await renderAudioDetail();

      expect(screen.getByText('audio/mpeg')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
    });

    it('renders metadata fields when present', async () => {
      await renderAudioDetail();

      expect(screen.getByText('Metadata')).toBeInTheDocument();
      expect(screen.getByText('Track Title')).toBeInTheDocument();
      expect(screen.getByText('Artist Name')).toBeInTheDocument();
      expect(screen.getByText('Album Name')).toBeInTheDocument();
      expect(screen.getByText('Album Artist Name')).toBeInTheDocument();
      expect(screen.getByText('2024')).toBeInTheDocument();
      expect(screen.getByText('2/10')).toBeInTheDocument();
      expect(screen.getByText('Rock, Alt')).toBeInTheDocument();
    });

    it('shows empty state when metadata is not available', async () => {
      mockExtractAudioMetadata.mockResolvedValueOnce(null);
      await renderAudioDetail();

      expect(
        screen.getByText('No embedded metadata found.')
      ).toBeInTheDocument();
    });

    it('renders play button', async () => {
      await renderAudioDetail();

      expect(screen.getByTestId('play-pause-button')).toBeInTheDocument();
      expect(screen.getByText('Play')).toBeInTheDocument();
    });

    it('renders download button', async () => {
      await renderAudioDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('renders share button when Web Share API is supported', async () => {
      mockCanShareFiles.mockReturnValue(true);
      await renderAudioDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();
    });

    it('hides share button when Web Share API is not supported', async () => {
      mockCanShareFiles.mockReturnValue(false);
      await renderAudioDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
      expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
    });
  });

  describe('when audio fails to load', () => {
    it('shows error message', async () => {
      const consoleSpy = mockConsoleError();
      mockRetrieve.mockRejectedValueOnce(new Error('Fetch failed'));

      renderAudioDetailRaw();

      await waitFor(() => {
        expect(screen.getByText('Fetch failed')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch audio:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('playback functionality', () => {
    it('calls play when play button is clicked and track is not current', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      await user.click(screen.getByTestId('play-pause-button'));

      expect(mockPlay).toHaveBeenCalledWith({
        id: 'audio-123',
        name: 'test-audio.mp3',
        objectUrl: expect.any(String),
        mimeType: 'audio/mpeg'
      });
    });

    it('calls pause when pause button is clicked and track is playing', async () => {
      mockUseAudio.mockReturnValue({
        currentTrack: { id: 'audio-123' },
        isPlaying: true,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume
      });

      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByText('Pause')).toBeInTheDocument();
      await user.click(screen.getByTestId('play-pause-button'));

      expect(mockPause).toHaveBeenCalled();
    });

    it('calls resume when play button is clicked and track is current but paused', async () => {
      mockUseAudio.mockReturnValue({
        currentTrack: { id: 'audio-123' },
        isPlaying: false,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume
      });

      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByText('Play')).toBeInTheDocument();
      await user.click(screen.getByTestId('play-pause-button'));

      expect(mockResume).toHaveBeenCalled();
    });
  });

  describe('download functionality', () => {
    it('downloads file when download button is clicked', async () => {
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/audio/test-audio.mp3',
          expect.any(Function)
        );
        expect(mockDownloadFile).toHaveBeenCalledWith(
          TEST_AUDIO_DATA,
          'test-audio.mp3'
        );
      });
    });

    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY
        );
      });
    });

    it('shows error when download fails', async () => {
      const consoleSpy = mockConsoleError();
      // First call succeeds (audio load), second call fails (download)
      mockRetrieve
        .mockResolvedValueOnce(TEST_AUDIO_DATA)
        .mockRejectedValueOnce(new Error('Storage read failed'));
      const user = userEvent.setup();
      await renderAudioDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(screen.getByText('Storage read failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to download audio:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
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

      const backLink = screen.getByText('Back to Audio');
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

  describe('URL lifecycle', () => {
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
    let mockCreateObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockRevokeObjectURL = vi.fn();
      mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('revokes object URLs when component unmounts and track is not playing', async () => {
      const { unmount } = await renderAudioDetail();

      // URL should have been created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Unmount the component
      unmount();

      // URL should be revoked since the track is not playing
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('does not revoke object URL when track is currently playing', async () => {
      // Set up the audio context to indicate this track is playing
      mockUseAudio.mockReturnValue({
        currentTrack: {
          id: 'audio-123',
          name: 'test.mp3',
          objectUrl: 'blob:test-url',
          mimeType: 'audio/mpeg'
        },
        isPlaying: true,
        play: mockPlay,
        pause: mockPause,
        resume: mockResume
      });

      const { unmount } = await renderAudioDetail('audio-123');

      // URL should have been created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Unmount the component
      unmount();

      // URL should NOT be revoked since the track is currently playing
      expect(mockRevokeObjectURL).not.toHaveBeenCalled();
    });
  });
});
