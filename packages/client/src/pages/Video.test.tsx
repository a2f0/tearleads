import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError, mockConsoleWarn } from '@/test/console-mocks';
import { VideoPage } from './Video';

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

const TEST_VIDEO = {
  id: 'video-1',
  name: 'test-video.mp4',
  size: 52428800, // 50 MB
  mimeType: 'video/mp4',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/videos/test-video.mp4',
  thumbnailPath: '/thumbnails/test-video.jpg'
};

const TEST_VIDEO_2 = {
  id: 'video-2',
  name: 'another-video.webm',
  size: 104857600, // 100 MB
  mimeType: 'video/webm',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/videos/another-video.webm',
  thumbnailPath: '/thumbnails/another-video.jpg'
};

const TEST_VIDEO_DATA = new Uint8Array([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70
]); // MP4 magic bytes
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

function renderVideoRaw() {
  return render(
    <MemoryRouter>
      <VideoPage />
    </MemoryRouter>
  );
}

async function renderVideo() {
  const result = renderVideoRaw();
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading videos...')).not.toBeInTheDocument();
  });
  return result;
}

describe('VideoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mocks for unlocked database
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_VIDEO_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
    mockUpdate.mockReturnValue(createMockUpdateChain());
    mockUploadFile.mockResolvedValue({ id: 'new-id', isDuplicate: false });
    mockDetectPlatform.mockReturnValue('web');
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderVideo();

      expect(screen.getByText('Videos')).toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      await renderVideo();

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
      renderVideoRaw();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderVideoRaw();

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
      renderVideoRaw();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view videos./i
        )
      ).toBeInTheDocument();
    });

    it('does not show Refresh button', () => {
      renderVideoRaw();

      expect(
        screen.queryByRole('button', { name: 'Refresh' })
      ).not.toBeInTheDocument();
    });
  });

  describe('when videos are loaded', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_VIDEO, TEST_VIDEO_2])
      );
    });

    it('displays video names', async () => {
      await renderVideo();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      expect(screen.getByText('another-video.webm')).toBeInTheDocument();
    });

    it('displays video sizes', async () => {
      await renderVideo();

      expect(screen.getByText('50 MB')).toBeInTheDocument();
      expect(screen.getByText('100 MB')).toBeInTheDocument();
    });

    it('shows video count', async () => {
      await renderVideo();

      expect(screen.getByText(/2 videos$/)).toBeInTheDocument();
    });

    it('renders video items', async () => {
      await renderVideo();

      expect(screen.getByTestId('video-item-video-1')).toBeInTheDocument();
      expect(screen.getByTestId('video-item-video-2')).toBeInTheDocument();
    });

    it('renders detail navigation buttons for videos', async () => {
      await renderVideo();

      const detailButtons = screen.getAllByRole('button', {
        name: /view details/i
      });
      expect(detailButtons).toHaveLength(2);
    });

    it('fetches thumbnail data from storage', async () => {
      await renderVideo();

      // Only thumbnails should be fetched, not full video data
      expect(mockRetrieve).toHaveBeenCalledWith(
        '/thumbnails/test-video.jpg',
        expect.any(Function)
      );
      expect(mockRetrieve).toHaveBeenCalledWith(
        '/thumbnails/another-video.jpg',
        expect.any(Function)
      );
      // Full video data should NOT be fetched on the list page
      expect(mockRetrieve).not.toHaveBeenCalledWith(
        '/videos/test-video.mp4',
        expect.any(Function)
      );
    });

    it('creates object URLs for thumbnails', async () => {
      await renderVideo();

      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('revokes thumbnail URLs on unmount', async () => {
      const { unmount } = await renderVideo();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();

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

    it('shows dropzone when no videos', async () => {
      await renderVideo();

      expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    });

    const hintText = 'Drop a video file here to add it to your library';

    it.each([
      'web',
      'electron'
    ])('shows drag and drop hint on %s', async (platform) => {
      mockDetectPlatform.mockReturnValue(platform);
      await renderVideo();
      expect(screen.getByText(hintText)).toBeInTheDocument();
    });

    it.each([
      'ios',
      'android'
    ])('hides drag and drop hint on %s', async (platform) => {
      mockDetectPlatform.mockReturnValue(platform);
      await renderVideo();
      expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message while fetching videos', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
          })
        })
      });

      renderVideoRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Loading videos...')).toBeInTheDocument();
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

      renderVideoRaw();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch videos:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles thumbnail load failure gracefully', async () => {
      const consoleSpy = mockConsoleWarn();
      mockRetrieve.mockRejectedValue(new Error('Storage error'));

      await renderVideo();

      // Video should still be displayed even if thumbnail failed to load
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      // But no object URL should be created for the thumbnail
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load thumbnail for test-video.mp4:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('refresh functionality', () => {
    it('refreshes video list when Refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderVideo();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();

      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));

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

      renderVideoRaw();

      // Flush the setTimeout used for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(screen.getByText('Loading videos...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    });
  });

  describe('file storage initialization', () => {
    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);

      await renderVideo();

      expect(mockInitializeFileStorage).toHaveBeenCalledWith(
        TEST_ENCRYPTION_KEY
      );
    });
  });

  describe('file upload', () => {
    let user: ReturnType<typeof userEvent.setup>;
    const videoFile = new File(['video content'], 'test.mp4', {
      type: 'video/mp4'
    });
    let input: HTMLElement;

    beforeEach(async () => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
      mockDetectPlatform.mockReturnValue('web');
      user = userEvent.setup();
      await renderVideo();

      expect(screen.getByTestId('dropzone')).toBeInTheDocument();

      input = screen.getByTestId('dropzone-input');
    });

    it('uploads valid video file when dropped', async () => {
      await user.upload(input as HTMLInputElement, videoFile);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'test.mp4' }),
          expect.any(Function)
        );
      });
    });

    it('refreshes videos after successful upload', async () => {
      mockSelect.mockClear();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));

      await user.upload(input as HTMLInputElement, videoFile);

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

      await user.upload(input as HTMLInputElement, videoFile);

      await waitFor(() => {
        expect(screen.getByText('Upload failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('shows error for unsupported video format', async () => {
      // Use video/x-ms-wmv which is not in VIDEO_MIME_TYPES list
      const unsupportedFile = new File(['content'], 'test.wmv', {
        type: 'video/x-ms-wmv'
      });

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await user.upload(input as HTMLInputElement, unsupportedFile);

      await waitFor(() => {
        expect(
          screen.getByText(/has an unsupported video format/i)
        ).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
    });

    it('navigates to video detail when double-clicked on web/electron', async () => {
      mockDetectPlatform.mockReturnValue('web');
      const user = userEvent.setup();
      await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      });

      await user.dblClick(screen.getByTestId('video-open-video-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
        state: { from: '/', fromLabel: 'Back to Videos' }
      });
    });

    it('navigates to video detail when single-clicked on iOS', async () => {
      mockDetectPlatform.mockReturnValue('ios');
      const user = userEvent.setup();
      await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('video-open-video-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
        state: { from: '/', fromLabel: 'Back to Videos' }
      });
    });

    it('navigates to video detail when single-clicked on Android', async () => {
      mockDetectPlatform.mockReturnValue('android');
      const user = userEvent.setup();
      await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('video-open-video-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
        state: { from: '/', fromLabel: 'Back to Videos' }
      });
    });

    it('does not navigate on single click for web/electron', async () => {
      mockDetectPlatform.mockReturnValue('web');
      const user = userEvent.setup();
      await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('video-open-video-1'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
    });

    async function openContextMenuOnVideo(
      user: ReturnType<typeof userEvent.setup>,
      videoId: string
    ) {
      const videoRow = screen.getByTestId(`video-item-${videoId}`);
      await user.pointer({ keys: '[MouseRight]', target: videoRow });
      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });
    }

    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

      expect(screen.getByText('Play')).toBeInTheDocument();
      expect(screen.getByText('Get info')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('navigates to video detail when "Play" is clicked', async () => {
      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

      await user.click(screen.getByText('Play'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
        state: { from: '/', fromLabel: 'Back to Videos' }
      });
    });

    it('navigates to video detail when "Get info" is clicked', async () => {
      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
        state: { from: '/', fromLabel: 'Back to Videos' }
      });
    });

    it('deletes video and removes from list when "Delete" is clicked', async () => {
      const user = userEvent.setup();
      await renderVideo();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();

      await openContextMenuOnVideo(user, 'video-1');

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(screen.queryByText('test-video.mp4')).not.toBeInTheDocument();
      });
    });

    it('revokes thumbnail URL when deleting a video', async () => {
      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
      });
    });

    it('shows error when delete fails', async () => {
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');
      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });

    it('shows error when delete fails with non-Error object', async () => {
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue('String error')
        })
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');
      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup();
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

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
      await renderVideo();

      await openContextMenuOnVideo(user, 'video-1');

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });
  });

  describe('instance switching', () => {
    it('refetches videos when instance changes', async () => {
      const { rerender } = await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
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
          <VideoPage />
        </MemoryRouter>
      );

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify that videos were fetched again
      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });
  });
});
