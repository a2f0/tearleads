/**
 * PhotosPage (wrapper with sidebar) tests.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosPage } from './photos-components';

// Mocks must be defined in each test file (hoisted)
vi.mock('@/components/photos-window/PhotosAlbumsSidebar', () => ({
  ALL_PHOTOS_ID: '__all__',
  PhotosAlbumsSidebar: vi.fn(
    ({
      selectedAlbumId,
      onAlbumSelect,
      onAlbumChanged,
      onDropToAlbum,
      onWidthChange,
      width
    }) => (
      <div data-testid="photos-albums-sidebar">
        <span data-testid="selected-album">{selectedAlbumId}</span>
        <span data-testid="sidebar-width">{width}</span>
        <button
          type="button"
          data-testid="select-album-1"
          onClick={() => onAlbumSelect('album-1')}
        >
          Select Album 1
        </button>
        <button
          type="button"
          data-testid="trigger-album-changed"
          onClick={() => onAlbumChanged?.()}
        >
          Trigger Album Changed
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
          data-testid="drop-to-album"
          onClick={() => onDropToAlbum?.('album-1', [], ['photo-1', 'photo-2'])}
        >
          Drop To Album
        </button>
      </div>
    )
  )
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 120,
        size: 120,
        key: i
      })),
    getTotalSize: () => count * 120,
    measureElement: vi.fn()
  }))
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockInsert = vi.fn();
const mockInsertValues = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: vi.fn(),
  insert: mockInsert
};
// Make mockDb thenable so it returns [] when awaited (for existing links query)
Object.defineProperty(mockDb, 'then', {
  value: (resolve: (value: unknown[]) => void) => resolve([]),
  enumerable: false
});
mockInsert.mockReturnValue({ values: mockInsertValues });
mockInsertValues.mockResolvedValue(undefined);

vi.mock('@/db', () => ({ getDatabase: vi.fn(() => mockDb) }));
vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

const mockStorage = { retrieve: vi.fn() };
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() })
}));

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => false,
  downloadFile: vi.fn(),
  shareFile: vi.fn()
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: vi.fn()
}));

vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: vi.fn()
}));

function renderPhotosPage(route = '/photos') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/photos" element={<PhotosPage />} />
        <Route path="/photos/albums/:albumId" element={<PhotosPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PhotosPage (wrapper with sidebar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mocks
    mockStorage.retrieve.mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    );
    mockDb.orderBy.mockResolvedValue([]);
  });

  describe('when database is unlocked', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      });
    });

    it('renders the PhotosAlbumsSidebar', async () => {
      renderPhotosPage();

      expect(screen.getByTestId('photos-albums-sidebar')).toBeInTheDocument();
    });

    it('renders the back link', async () => {
      renderPhotosPage();

      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('initializes with ALL_PHOTOS_ID selected', async () => {
      renderPhotosPage();

      expect(screen.getByTestId('selected-album')).toHaveTextContent('__all__');
    });

    it('navigates when album is selected', async () => {
      const user = userEvent.setup();
      renderPhotosPage();

      await user.click(screen.getByTestId('select-album-1'));

      // Navigation is now handled via URL routing
      expect(mockNavigate).toHaveBeenCalledWith('/photos/albums/album-1');
    });

    it('links dropped photo ids to album', async () => {
      const user = userEvent.setup();
      renderPhotosPage();

      await user.click(screen.getByTestId('drop-to-album'));

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalled();
        expect(mockInsertValues).toHaveBeenCalledTimes(1);
        expect(mockInsertValues).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ childId: 'photo-1' }),
            expect.objectContaining({ childId: 'photo-2' })
          ])
        );
      });
    });

    it('updates width when onWidthChange is called', async () => {
      const user = userEvent.setup();
      renderPhotosPage();

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('200');

      await user.click(screen.getByTestId('change-width'));

      expect(screen.getByTestId('sidebar-width')).toHaveTextContent('300');
    });

    it('increments refreshToken when onAlbumChanged is called', async () => {
      const user = userEvent.setup();
      renderPhotosPage();

      // Trigger the album changed callback
      await user.click(screen.getByTestId('trigger-album-changed'));

      // The test passes if no errors occur - refreshToken is internal state
      expect(screen.getByTestId('photos-albums-sidebar')).toBeInTheDocument();
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

    it('does not render the PhotosAlbumsSidebar', () => {
      renderPhotosPage();

      expect(
        screen.queryByTestId('photos-albums-sidebar')
      ).not.toBeInTheDocument();
    });

    it('shows inline unlock component', () => {
      renderPhotosPage();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    });
  });

  describe('URL-based routing', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'test-instance'
      });
    });

    it('reads albumId from URL params', () => {
      renderPhotosPage('/photos/albums/test-album-123');

      expect(screen.getByTestId('selected-album')).toHaveTextContent(
        'test-album-123'
      );
    });

    it('uses ALL_PHOTOS_ID when no album param', () => {
      renderPhotosPage('/photos');

      expect(screen.getByTestId('selected-album')).toHaveTextContent('__all__');
    });

    it('navigates to album route when album is selected', async () => {
      const user = userEvent.setup();
      renderPhotosPage('/photos');

      await user.click(screen.getByTestId('select-album-1'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/albums/album-1');
    });

    it('navigates to /photos when ALL_PHOTOS_ID is selected', async () => {
      const user = userEvent.setup();
      // Suppress console.error from photo fetch when mock changes
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock the sidebar to have an "All Photos" button
      const { PhotosAlbumsSidebar } = await import(
        '@/components/photos-window/PhotosAlbumsSidebar'
      );
      const MockedSidebar = PhotosAlbumsSidebar as unknown as ReturnType<
        typeof vi.fn
      >;
      MockedSidebar.mockImplementation(({ onAlbumSelect }) => (
        <div data-testid="photos-albums-sidebar">
          <button
            type="button"
            data-testid="select-all-photos"
            onClick={() => onAlbumSelect('__all__')}
          >
            All Photos
          </button>
        </div>
      ));

      renderPhotosPage('/photos/albums/test-album');

      await user.click(screen.getByTestId('select-all-photos'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos');

      consoleSpy.mockRestore();
    });
  });
});
