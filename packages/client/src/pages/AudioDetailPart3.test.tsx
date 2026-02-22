import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
