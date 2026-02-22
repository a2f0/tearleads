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
