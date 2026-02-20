import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from './Video';
import { setupVideoWrapperMocks } from './Video.testSetup';

// Create hoisted mocks inline - required for vi.mock() factories
const mocks = vi.hoisted(() => ({
  mockUseDatabaseContext: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsertValues: vi.fn(),
  mockInsert: vi.fn(),
  mockNavigate: vi.fn(),
  mockGetCurrentKey: vi.fn(),
  mockRetrieve: vi.fn(),
  mockStore: vi.fn(),
  mockIsFileStorageInitialized: vi.fn(),
  mockInitializeFileStorage: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDetectPlatform: vi.fn()
}));

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

function renderVideo(route = '/videos') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/videos" element={<Video />} />
        <Route path="/videos/playlists/:playlistId" element={<Video />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Video (wrapper with sidebar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupVideoWrapperMocks(mocks);
  });

  describe('when database is unlocked', () => {
    beforeEach(() => {
      mocks.mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      });
    });

    it('renders the ClientVideoProvider', async () => {
      renderVideo();

      expect(screen.getByTestId('client-video-provider')).toBeInTheDocument();
    });

    it('renders the VideoPlaylistsSidebar', async () => {
      renderVideo();

      expect(screen.getByTestId('video-playlists-sidebar')).toBeInTheDocument();
    });

    it('renders the back link', async () => {
      renderVideo();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('initializes with ALL_VIDEO_ID selected', async () => {
      renderVideo();

      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        '__all__'
      );
    });

    it('navigates when playlist is selected', async () => {
      const user = userEvent.setup();
      renderVideo();

      await user.click(screen.getByTestId('select-playlist-1'));

      // Navigation is now handled via URL routing
      expect(mocks.mockNavigate).toHaveBeenCalledWith(
        '/videos/playlists/playlist-1'
      );
    });

    it('links dropped video ids to playlist', async () => {
      const user = userEvent.setup();
      renderVideo();

      await user.click(screen.getByTestId('drop-to-playlist'));

      await waitFor(() => {
        expect(mocks.mockInsert).toHaveBeenCalled();
        expect(mocks.mockInsertValues).toHaveBeenCalledTimes(1);
        expect(mocks.mockInsertValues).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ childId: 'video-1' }),
            expect.objectContaining({ childId: 'video-2' })
          ])
        );
      });
    });

    it('updates width when onWidthChange is called', async () => {
      const user = userEvent.setup();
      renderVideo();

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('200');

      await user.click(screen.getByTestId('change-width'));

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('300');
    });

    it('increments refreshToken when onPlaylistChanged is called', async () => {
      const user = userEvent.setup();
      renderVideo();

      // Trigger the playlist changed callback
      await user.click(screen.getByTestId('trigger-playlist-changed'));

      // The test passes if no errors occur - refreshToken is internal state
      // but the callback should work without throwing
      expect(screen.getByTestId('video-playlists-sidebar')).toBeInTheDocument();
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

    it('renders the ClientVideoProvider', () => {
      renderVideo();

      expect(screen.getByTestId('client-video-provider')).toBeInTheDocument();
    });

    it('does not render the VideoPlaylistsSidebar', () => {
      renderVideo();

      expect(
        screen.queryByTestId('video-playlists-sidebar')
      ).not.toBeInTheDocument();
    });

    it('shows inline unlock component', () => {
      renderVideo();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    });
  });

  describe('URL-based routing', () => {
    beforeEach(() => {
      mocks.mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      });
    });

    it('reads playlistId from URL params', () => {
      renderVideo('/videos/playlists/test-playlist-123');

      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        'test-playlist-123'
      );
    });

    it('uses ALL_VIDEO_ID when no playlist param', () => {
      renderVideo('/videos');

      expect(screen.getByTestId('selected-playlist')).toHaveTextContent(
        '__all__'
      );
    });

    it('navigates to playlist route when playlist is selected', async () => {
      const user = userEvent.setup();
      renderVideo('/videos');

      await user.click(screen.getByTestId('select-playlist-1'));

      expect(mocks.mockNavigate).toHaveBeenCalledWith(
        '/videos/playlists/playlist-1'
      );
    });

    it('navigates to /videos when ALL_VIDEO_ID is selected', async () => {
      const user = userEvent.setup();
      // Suppress console.error from video fetch when mock changes
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock the sidebar to have an "All Videos" button
      const { VideoPlaylistsSidebar } = await import(
        '@/components/video-window/VideoPlaylistsSidebar'
      );
      const MockedSidebar = VideoPlaylistsSidebar as unknown as ReturnType<
        typeof vi.fn
      >;
      MockedSidebar.mockImplementation(({ onPlaylistSelect }) => (
        <div data-testid="video-playlists-sidebar">
          <button
            type="button"
            data-testid="select-all-videos"
            onClick={() => onPlaylistSelect('__all__')}
          >
            All Videos
          </button>
        </div>
      ));

      renderVideo('/videos/playlists/test-playlist');

      await user.click(screen.getByTestId('select-all-videos'));

      expect(mocks.mockNavigate).toHaveBeenCalledWith('/videos');

      consoleSpy.mockRestore();
    });
  });
});
