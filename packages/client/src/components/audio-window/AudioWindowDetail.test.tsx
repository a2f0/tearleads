import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioWindowDetail } from './AudioWindowDetail';

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect,
    update: mockUpdate
  })
}));

const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array, instanceId: string) =>
    mockInitializeFileStorage(key, instanceId),
  createRetrieveLogger: () => vi.fn()
}));

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

const mockExtractAudioMetadata = vi.fn();
vi.mock('@/lib/audio-metadata', () => ({
  extractAudioMetadata: (data: Uint8Array, mimeType: string) =>
    mockExtractAudioMetadata(data, mimeType)
}));

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
  storagePath: '/audio/test-audio.mp3',
  thumbnailPath: null
};

const TEST_AUDIO_DATA = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result)
      })
    })
  };
}

function renderAudioWindowDetail(
  props: { audioId?: string; onBack?: () => void; onDeleted?: () => void } = {}
) {
  const {
    audioId = 'audio-123',
    onBack = vi.fn(),
    onDeleted = vi.fn()
  } = props;
  return render(
    <ThemeProvider>
      <AudioWindowDetail
        audioId={audioId}
        onBack={onBack}
        onDeleted={onDeleted}
      />
    </ThemeProvider>
  );
}

describe('AudioWindowDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  it('shows loading state when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true,
      currentInstanceId: null
    });

    renderAudioWindowDetail();

    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false,
      currentInstanceId: null,
      isSetUp: true,
      hasPersistedSession: false,
      unlock: vi.fn(),
      restoreSession: vi.fn()
    });

    renderAudioWindowDetail();

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('renders audio details and metadata', async () => {
    renderAudioWindowDetail();

    await waitFor(() => {
      expect(screen.getByText('Audio Details')).toBeInTheDocument();
    });

    expect(screen.getByText('test-audio.mp3')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText('Track Title')).toBeInTheDocument();
  });

  it('shows an error when the audio record is missing', async () => {
    mockSelect.mockReturnValue(createMockQueryChain([]));

    renderAudioWindowDetail();

    await waitFor(() => {
      expect(screen.getByText('Audio file not found')).toBeInTheDocument();
    });
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderAudioWindowDetail({ onBack });

    const backButton = await screen.findByRole('button', { name: 'Back' });
    await user.click(backButton);

    expect(onBack).toHaveBeenCalled();
  });

  it('updates the title when saving edits', async () => {
    const user = userEvent.setup();
    renderAudioWindowDetail();

    await screen.findByText('test-audio.mp3');

    await user.click(screen.getByTestId('audio-title-edit'));
    const titleInput = screen.getByTestId('audio-title-input');
    await user.clear(titleInput);
    await user.type(titleInput, 'new-name.mp3');
    await user.click(screen.getByTestId('audio-title-save'));

    await waitFor(() => {
      expect(screen.getByText('new-name.mp3')).toBeInTheDocument();
    });
  });

  it('shows empty metadata when no tags are found', async () => {
    mockExtractAudioMetadata.mockResolvedValue({});

    renderAudioWindowDetail();

    await waitFor(() => {
      expect(
        screen.getByText('No embedded metadata found.')
      ).toBeInTheDocument();
    });
  });

  it('initializes storage and loads thumbnails when available', async () => {
    const audioWithThumbnail = {
      ...TEST_AUDIO,
      thumbnailPath: '/audio/thumb.jpg'
    };
    mockIsFileStorageInitialized.mockReturnValue(false);
    mockSelect.mockReturnValue(createMockQueryChain([audioWithThumbnail]));
    mockRetrieve
      .mockResolvedValueOnce(TEST_AUDIO_DATA)
      .mockResolvedValueOnce(new Uint8Array([0x01, 0x02]));

    renderAudioWindowDetail();

    const albumCover = await screen.findByAltText('Album cover');
    expect(albumCover).toBeInTheDocument();
    expect(mockInitializeFileStorage).toHaveBeenCalledWith(
      TEST_ENCRYPTION_KEY,
      'test-instance'
    );
  });

  it('falls back when thumbnail retrieval fails', async () => {
    const audioWithThumbnail = {
      ...TEST_AUDIO,
      thumbnailPath: '/audio/thumb.jpg'
    };
    mockSelect.mockReturnValue(createMockQueryChain([audioWithThumbnail]));
    mockRetrieve
      .mockResolvedValueOnce(TEST_AUDIO_DATA)
      .mockRejectedValueOnce(new Error('thumbnail failed'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderAudioWindowDetail();

    await waitFor(() => {
      expect(screen.getByText('Audio Details')).toBeInTheDocument();
    });
    expect(screen.queryByAltText('Album cover')).not.toBeInTheDocument();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('plays the track when clicking play', async () => {
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const playButton = await screen.findByTestId('play-pause-button');
    await user.click(playButton);

    expect(mockPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'audio-123',
        name: 'test-audio.mp3',
        mimeType: 'audio/mpeg'
      })
    );
  });

  it('revokes object URLs on unmount when not playing', async () => {
    const { unmount } = renderAudioWindowDetail();

    await waitFor(() => {
      expect(screen.getByText('Audio Details')).toBeInTheDocument();
    });

    unmount();
    expect(mockRevokeObjectURL).toHaveBeenCalled();
  });

  it('keeps the current track URL on unmount when playing', async () => {
    mockUseAudio.mockReturnValue({
      currentTrack: { id: 'audio-123' },
      isPlaying: true,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume
    });
    const { unmount } = renderAudioWindowDetail();

    await waitFor(() => {
      expect(screen.getByText('Audio Details')).toBeInTheDocument();
    });

    unmount();
    expect(mockRevokeObjectURL).not.toHaveBeenCalled();
  });

  it('pauses when the current track is playing', async () => {
    mockUseAudio.mockReturnValue({
      currentTrack: { id: 'audio-123' },
      isPlaying: true,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume
    });
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const playButton = await screen.findByTestId('play-pause-button');
    await user.click(playButton);

    expect(mockPause).toHaveBeenCalled();
  });

  it('resumes when the current track is paused', async () => {
    mockUseAudio.mockReturnValue({
      currentTrack: { id: 'audio-123' },
      isPlaying: false,
      play: mockPlay,
      pause: mockPause,
      resume: mockResume
    });
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const playButton = await screen.findByTestId('play-pause-button');
    await user.click(playButton);

    expect(mockResume).toHaveBeenCalled();
  });

  it('shows an error when sharing is unsupported', async () => {
    mockShareFile.mockResolvedValue(false);
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const shareButton = await screen.findByTestId('share-button');
    await user.click(shareButton);

    await waitFor(() => {
      expect(
        screen.getByText('Sharing is not supported on this device')
      ).toBeInTheDocument();
    });
  });

  it('ignores aborted share requests', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockShareFile.mockRejectedValue(abortError);
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const shareButton = await screen.findByTestId('share-button');
    await user.click(shareButton);

    await waitFor(() => {
      expect(mockShareFile).toHaveBeenCalled();
    });
    expect(
      screen.queryByText('Sharing is not supported on this device')
    ).not.toBeInTheDocument();
  });

  it('downloads, shares, and deletes audio from action toolbar', async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderAudioWindowDetail({ onDeleted });

    const downloadButton = await screen.findByTestId('download-button');
    await user.click(downloadButton);
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'test-audio.mp3'
    );

    const shareButton = await screen.findByTestId('share-button');
    await user.click(shareButton);
    expect(mockShareFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'test-audio.mp3',
      'audio/mpeg'
    );

    const deleteButton = await screen.findByTestId('delete-button');
    await user.click(deleteButton);
    expect(onDeleted).toHaveBeenCalled();
  });

  it('shows an error when download fails', async () => {
    mockRetrieve
      .mockResolvedValueOnce(TEST_AUDIO_DATA)
      .mockRejectedValueOnce(new Error('download failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const downloadButton = await screen.findByTestId('download-button');
    await user.click(downloadButton);

    await waitFor(() => {
      expect(screen.getByText('download failed')).toBeInTheDocument();
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows an error when delete fails', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('delete failed'))
      })
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    renderAudioWindowDetail();

    const deleteButton = await screen.findByTestId('delete-button');
    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('delete failed')).toBeInTheDocument();
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
