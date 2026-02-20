import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPage } from './Video';
import {
  createMockQueryChain,
  createMockUpdateChain,
  createVideoMocks,
  setupVideoPageMocks,
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

describe('VideoPage - Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVideoPageMocks(mocks);
    mocks.mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
  });

  it('navigates to video detail when double-clicked on web/electron', async () => {
    mocks.mockDetectPlatform.mockReturnValue('web');
    const user = userEvent.setup();
    await renderVideo();

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    await user.dblClick(screen.getByTestId('video-open-video-1'));

    expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
      state: { from: '/', fromLabel: 'Back to Videos' }
    });
  });

  it('navigates to video detail when single-clicked on iOS', async () => {
    mocks.mockDetectPlatform.mockReturnValue('ios');
    const user = userEvent.setup();
    await renderVideo();

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('video-open-video-1'));

    expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
      state: { from: '/', fromLabel: 'Back to Videos' }
    });
  });

  it('navigates to video detail when single-clicked on Android', async () => {
    mocks.mockDetectPlatform.mockReturnValue('android');
    const user = userEvent.setup();
    await renderVideo();

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('video-open-video-1'));

    expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
      state: { from: '/', fromLabel: 'Back to Videos' }
    });
  });

  it('does not navigate on single click for web/electron', async () => {
    mocks.mockDetectPlatform.mockReturnValue('web');
    const user = userEvent.setup();
    await renderVideo();

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('video-open-video-1'));

    expect(mocks.mockNavigate).not.toHaveBeenCalled();
  });
});

describe('VideoPage - Context Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVideoPageMocks(mocks);
    mocks.mockSelect.mockReturnValue(createMockQueryChain([TEST_VIDEO]));
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

    expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
      state: { from: '/', fromLabel: 'Back to Videos', autoPlay: true }
    });
  });

  it('navigates to video detail when "Get info" is clicked', async () => {
    const user = userEvent.setup();
    await renderVideo();

    await openContextMenuOnVideo(user, 'video-1');

    await user.click(screen.getByText('Get info'));

    expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos/video-1', {
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
      expect(mocks.mockUpdate).toHaveBeenCalled();
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
    mocks.mockUpdate.mockReturnValue({
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
    mocks.mockUpdate.mockReturnValue({
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

describe('VideoPage - Blank Space Context Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVideoPageMocks(mocks);
  });

  it('shows upload context menu on right-click when onUpload is provided', async () => {
    const mockOnUpload = vi.fn();
    await renderVideo({ onUpload: mockOnUpload });

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    // Find the scroll container with the list and right-click
    const scrollContainer = screen
      .getByText('test-video.mp4')
      .closest('[class*="overflow-auto"]');
    expect(scrollContainer).toBeInTheDocument();

    if (scrollContainer) {
      await act(async () => {
        scrollContainer.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 200
          })
        );
      });
    }

    await waitFor(() => {
      expect(screen.getByText('Upload')).toBeInTheDocument();
    });
  });

  it('calls onUpload when upload menu item is clicked', async () => {
    const user = userEvent.setup();
    const mockOnUpload = vi.fn();
    await renderVideo({ onUpload: mockOnUpload });

    await waitFor(() => {
      expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
    });

    // Find the scroll container and right-click
    const scrollContainer = screen
      .getByText('test-video.mp4')
      .closest('[class*="overflow-auto"]');

    if (scrollContainer) {
      await act(async () => {
        scrollContainer.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 100,
            clientY: 200
          })
        );
      });
    }

    await waitFor(() => {
      expect(screen.getByText('Upload')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Upload'));

    expect(mockOnUpload).toHaveBeenCalled();
  });
});
