import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError, mockConsoleWarn } from '@/test/consoleMocks';
import { VideoPage } from './Video';
import {
  createMockQueryChain,
  createVideoMocks,
  setupVideoPageMocks,
  TEST_ENCRYPTION_KEY,
  TEST_VIDEO
} from './Video.testSetup';

// Create hoisted mocks that can be used in vi.mock() calls
const mocks = vi.hoisted(() => createVideoMocks());

// Mock VideoPlaylistsSidebar
vi.mock('@/components/video-window/VideoPlaylistsSidebar', () => ({
  ALL_VIDEO_ID: '__all__',
  VideoPlaylistsSidebar: vi.fn(
    ({
      selectedPlaylistId,
      onPlaylistSelect,
      onPlaylistChanged,
      onDropToPlaylist,
      onWidthChange,
      width
    }) => (
      <div data-testid="video-playlists-sidebar">
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
            onDropToPlaylist?.('playlist-1', [], ['video-1', 'video-2'])
          }
        >
          Drop To Playlist
        </button>
      </div>
    )
  )
}));

// Mock ClientVideoProvider
vi.mock('@/contexts/ClientVideoProvider', () => ({
  ClientVideoProvider: vi.fn(({ children }) => (
    <div data-testid="client-video-provider">{children}</div>
  ))
}));

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
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mocks.mockUseDatabaseContext()
}));

// Mock the database
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
    insert: mocks.mockInsert
  })
}));

// Mock navigation
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mocks.mockNavigate,
    useLocation: () => ({ pathname: '/', state: null })
  };
});

// Mock the key manager
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mocks.mockGetCurrentKey
  })
}));

// Mock file storage
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mocks.mockRetrieve,
    measureRetrieve: mocks.mockRetrieve,
    store: mocks.mockStore
  }),
  isFileStorageInitialized: () => mocks.mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) =>
    mocks.mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock useFileUpload hook
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mocks.mockUploadFile
  })
}));

// Mock detectPlatform to return 'web' by default (supports drag and drop)
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: () => mocks.mockDetectPlatform()
  };
});

function renderVideoRaw(props?: {
  onOpenVideo?: (
    videoId: string,
    options?: { autoPlay?: boolean | undefined }
  ) => void;
  hideBackLink?: boolean;
  viewMode?: 'list' | 'table';
}) {
  return render(
    <MemoryRouter>
      <VideoPage {...props} />
    </MemoryRouter>
  );
}

async function renderVideo(props?: {
  onOpenVideo?: (
    videoId: string,
    options?: { autoPlay?: boolean | undefined }
  ) => void;
  hideBackLink?: boolean;
  viewMode?: 'list' | 'table';
  onUpload?: () => void;
}) {
  const result = renderVideoRaw(props);
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
    setupVideoPageMocks(mocks);
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderVideo();

      expect(screen.getByText('Videos')).toBeInTheDocument();
    });

    it('shows back link by default', async () => {
      await renderVideo();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('hides the back link when requested', () => {
      renderVideoRaw({ hideBackLink: true });

      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });

    it('renders Refresh button when unlocked', async () => {
      await renderVideo();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });

    it('renders a table when viewMode is table', async () => {
      await renderVideo({ viewMode: 'table' });

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(
        screen.getByRole('columnheader', { name: 'Name' })
      ).toBeInTheDocument();
    });

    it('renders virtualized table rows with proper positioning', async () => {
      await renderVideo({ viewMode: 'table' });

      const row = screen.getByText('test-video.mp4').closest('tr');
      expect(row).toBeInTheDocument();
      expect(row).toHaveAttribute('style');
      expect(row).toHaveStyle({ position: 'absolute' });

      const tbody = row?.closest('tbody');
      expect(tbody).toBeInTheDocument();
      expect(tbody).toHaveAttribute('style');
      expect(tbody).toHaveStyle({ position: 'relative' });
    });
  });

  describe('when database is loading', () => {
    beforeEach(() => {
      mocks.mockUseDatabaseContext.mockReturnValue({
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
      mocks.mockUseDatabaseContext.mockReturnValue({
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

  describe('loading state', () => {
    it('shows loading message while fetching videos', async () => {
      mocks.mockSelect.mockReturnValue({
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
      mocks.mockSelect.mockReturnValue({
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
      mocks.mockRetrieve.mockRejectedValue(new Error('Storage error'));

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
      const { user } = await import('@testing-library/user-event');
      const userSetup = user.setup();
      await renderVideo();

      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();

      mocks.mockSelect.mockClear();
      mocks.mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));

      await userSetup.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mocks.mockSelect).toHaveBeenCalled();
      });
    });

    it('disables Refresh button while loading', async () => {
      mocks.mockSelect.mockReturnValue({
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
      mocks.mockIsFileStorageInitialized.mockReturnValue(false);

      await renderVideo();

      expect(mocks.mockInitializeFileStorage).toHaveBeenCalledWith(
        TEST_ENCRYPTION_KEY
      );
    });
  });

  describe('instance switching', () => {
    it('refetches videos when instance changes', async () => {
      const { rerender } = await renderVideo();

      await waitFor(() => {
        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
      });

      // Clear mocks to track new calls
      mocks.mockSelect.mockClear();

      // Change the instance
      mocks.mockUseDatabaseContext.mockReturnValue({
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
        expect(mocks.mockSelect).toHaveBeenCalled();
      });
    });
  });
});
