import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPage } from './Video';
import {
  createMockQueryChain,
  createVideoMocks,
  setupVideoPageMocks,
  TEST_VIDEO,
  TEST_VIDEO_2
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

describe('VideoPage - Videos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVideoPageMocks(mocks);
  });

  describe('when videos are loaded', () => {
    beforeEach(() => {
      mocks.mockSelect.mockReturnValue(
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

    it('uses onOpenVideo when provided', async () => {
      const user = userEvent.setup();
      const onOpenVideo = vi.fn();

      await renderVideo({ onOpenVideo });

      await user.dblClick(screen.getByTestId('video-open-video-1'));
      expect(onOpenVideo).toHaveBeenCalledWith('video-1', undefined);
      expect(mocks.mockNavigate).not.toHaveBeenCalled();
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
      expect(mocks.mockRetrieve).toHaveBeenCalledWith(
        '/thumbnails/test-video.jpg',
        expect.any(Function)
      );
      expect(mocks.mockRetrieve).toHaveBeenCalledWith(
        '/thumbnails/another-video.jpg',
        expect.any(Function)
      );
      // Full video data should NOT be fetched on the list page
      expect(mocks.mockRetrieve).not.toHaveBeenCalledWith(
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
      mocks.mockSelect.mockReturnValue(createMockQueryChain([]));
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
      mocks.mockDetectPlatform.mockReturnValue(platform);
      await renderVideo();
      expect(screen.getByText(hintText)).toBeInTheDocument();
    });

    it.each([
      'ios',
      'android'
    ])('hides drag and drop hint on %s', async (platform) => {
      mocks.mockDetectPlatform.mockReturnValue(platform);
      await renderVideo();
      expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    });
  });
});
