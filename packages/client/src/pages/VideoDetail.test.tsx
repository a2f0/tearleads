import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { VideoDetail } from './VideoDetail';

// Mock HTMLVideoElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockLoad = vi.fn();

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    mockPlay
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    mockPause
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(
    mockLoad
  );
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

const TEST_VIDEO = {
  id: 'video-123',
  name: 'test-video.mp4',
  size: 2048,
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/videos/test-video.mp4',
  thumbnailPath: null
};

const TEST_VIDEO_DATA = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70
]); // MP4 magic bytes
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

function renderVideoDetailRaw(videoId: string = 'video-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/videos/${videoId}`]}>
        <Routes>
          <Route path="/videos/:id" element={<VideoDetail />} />
          <Route path="/videos" element={<div>Videos</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function renderVideoDetail(videoId: string = 'video-123') {
  const result = renderVideoDetailRaw(videoId);
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading video...')).not.toBeInTheDocument();
  });
  return result;
}

describe('VideoDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for unlocked database with video
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_VIDEO_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    });
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
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
      renderVideoDetailRaw();
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
      renderVideoDetailRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this video file./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderVideoDetailRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderVideoDetailRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when video is loaded', () => {
    it('renders video name', async () => {
      await renderVideoDetail();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    it('renders video details', async () => {
      await renderVideoDetail();

      expect(screen.getByText('video/mp4')).toBeInTheDocument();
      expect(screen.getByText('2 KB')).toBeInTheDocument();
    });

    it('renders video player element', async () => {
      await renderVideoDetail();

      expect(screen.getByTestId('video-player')).toBeInTheDocument();
    });

    it('renders download button', async () => {
      await renderVideoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('renders share button when Web Share API is supported', async () => {
      mockCanShareFiles.mockReturnValue(true);
      await renderVideoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();
    });

    it('hides share button when Web Share API is not supported', async () => {
      mockCanShareFiles.mockReturnValue(false);
      await renderVideoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
      expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
    });
  });

  describe('download functionality', () => {
    it('downloads file when download button is clicked', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/videos/test-video.mp4',
          expect.any(Function)
        );
        expect(mockDownloadFile).toHaveBeenCalledWith(
          TEST_VIDEO_DATA,
          'test-video.mp4'
        );
      });
    });

    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      const user = userEvent.setup();
      await renderVideoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY
        );
      });
    });
  });

  describe('share functionality', () => {
    beforeEach(() => {
      // Reset mock to ensure clean state (previous tests may have set up rejections)
      mockRetrieve.mockReset();
      mockRetrieve.mockResolvedValue(TEST_VIDEO_DATA);
    });

    it('shares file when share button is clicked', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/videos/test-video.mp4',
          expect.any(Function)
        );
        expect(mockShareFile).toHaveBeenCalledWith(
          TEST_VIDEO_DATA,
          'test-video.mp4',
          'video/mp4'
        );
      });
    });

    it('handles share cancellation gracefully', async () => {
      const abortError = new Error('User cancelled');
      abortError.name = 'AbortError';
      mockShareFile.mockRejectedValue(abortError);

      const user = userEvent.setup();
      await renderVideoDetail();

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
      await renderVideoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to share video:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when sharing is not supported on device', async () => {
      mockShareFile.mockResolvedValue(false);
      const user = userEvent.setup();
      await renderVideoDetail();

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
    it('deletes video when delete button is clicked', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      expect(screen.getByTestId('delete-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('shows error when delete fails', async () => {
      mockUpdate.mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      }));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const user = userEvent.setup();
      await renderVideoDetail();

      expect(screen.getByTestId('delete-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('delete-button'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });
  });

  describe('video not found', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows not found error', async () => {
      await renderVideoDetail();

      expect(screen.getByText('Video file not found')).toBeInTheDocument();
    });
  });

  describe('video fetch error handling', () => {
    it('shows error when video fetch fails with Error object', async () => {
      mockRetrieve.mockRejectedValue(new Error('Storage read failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await renderVideoDetail();

      await waitFor(() => {
        expect(screen.getByText('Storage read failed')).toBeInTheDocument();
      });
    });

    it('shows error when video fetch fails with non-Error object', async () => {
      mockRetrieve.mockRejectedValue('String error');
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await renderVideoDetail();

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
    });
  });

  describe('back navigation', () => {
    it('renders back link to videos page', async () => {
      await renderVideoDetail();

      const backLink = screen.getByText('Back to Videos');
      expect(backLink).toBeInTheDocument();
      expect(backLink.closest('a')).toHaveAttribute('href', '/videos');
    });
  });

  describe('name editing', () => {
    it('renders edit button for video name', async () => {
      await renderVideoDetail();

      expect(screen.getByTestId('video-title-edit')).toBeInTheDocument();
    });

    it('enters edit mode when edit button is clicked', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      await user.click(screen.getByTestId('video-title-edit'));

      expect(screen.getByTestId('video-title-input')).toBeInTheDocument();
      expect(screen.getByTestId('video-title-input')).toHaveValue(
        'test-video.mp4'
      );
    });

    it('updates video name when saved', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      await user.click(screen.getByTestId('video-title-edit'));
      await user.clear(screen.getByTestId('video-title-input'));
      await user.type(screen.getByTestId('video-title-input'), 'new-name.mp4');
      await user.click(screen.getByTestId('video-title-save'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('cancels edit mode when cancel button is clicked', async () => {
      const user = userEvent.setup();
      await renderVideoDetail();

      await user.click(screen.getByTestId('video-title-edit'));
      await user.clear(screen.getByTestId('video-title-input'));
      await user.type(screen.getByTestId('video-title-input'), 'new-name.mp4');
      await user.click(screen.getByTestId('video-title-cancel'));

      expect(screen.queryByTestId('video-title-input')).not.toBeInTheDocument();
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
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

    it('revokes object URLs when component unmounts', async () => {
      const { unmount } = await renderVideoDetail();

      // URL should have been created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Unmount the component
      unmount();

      // URL should be revoked on unmount
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});
