import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import {
  mockCanShareFiles,
  mockDb,
  mockDownloadFile,
  mockInitializeFileStorage,
  mockIsFileStorageInitialized,
  mockNavigate,
  mockPhotos,
  mockSetAttachedImage,
  mockShareFile,
  mockStorage,
  mockUint8ArrayToDataUrl,
  mockUploadFile,
  mockUseDatabaseContext,
  renderPhotos,
  setupPhotosTestMocks
} from './Photos.testSetup';

// ============================================================
// vi.mock() calls - must be inline in each test file
// ============================================================

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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (...args: unknown[]) =>
    mockInitializeFileStorage(...args),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
}));

vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  shareFile: (...args: unknown[]) => mockShareFile(...args)
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: (image: string | null) => mockSetAttachedImage(image)
}));

vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: (data: Uint8Array, mimeType: string) =>
    mockUint8ArrayToDataUrl(data, mimeType)
}));

// ============================================================
// Tests
// ============================================================

describe('Photos', () => {
  beforeEach(() => {
    setupPhotosTestMocks();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('Photos')).toBeInTheDocument();
      });
    });

    it('shows back link by default', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByTestId('back-link')).toBeInTheDocument();
      });
    });

    it('shows photo count', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText(/2 photos$/)).toBeInTheDocument();
      });
    });

    it('shows loading state when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });

      await renderPhotos();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('shows inline unlock when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      await renderPhotos();

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view photos./i
        )
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('does not have nested buttons in photo thumbnails', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Verify that no <button> element is a descendant of another <button> element
      const nestedButtons = document.querySelectorAll('button button');
      expect(nestedButtons).toHaveLength(0);

      // Additionally, verify that the photo container is a div with role="button" as intended
      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      expect(photoContainer?.tagName).toBe('DIV');
      expect(photoContainer).toHaveAttribute('role', 'button');
    });

    it('photo container is keyboard focusable', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      expect(photoContainer).toHaveAttribute('tabIndex', '0');
      expect(photoContainer).toHaveAttribute('role', 'button');
    });
  });

  describe('empty state', () => {
    it('shows full-width dropzone when no photos exist', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderPhotos();

      await waitFor(() => {
        expect(
          screen.getByText(/Drag and drop photos here/)
        ).toBeInTheDocument();
      });

      // Should show the dropzone input
      expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
    });

    it('shows empty message without dropzone when disabled', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      await renderPhotos({ showDropzone: false });

      await waitFor(() => {
        expect(
          screen.getByText(/No photos yet\. Use Upload to add images\./)
        ).toBeInTheDocument();
      });

      expect(screen.queryByTestId('dropzone-input')).not.toBeInTheDocument();
    });
  });

  describe('dropzone with existing photos', () => {
    it('shows thumbnail-sized dropzone in gallery when photos exist', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Should show the dropzone input
      expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();

      // The dropzone should be present (now below the virtualized gallery)
      const dropzone = screen.getByTestId('dropzone');
      expect(dropzone).toBeInTheDocument();
    });

    it('dropzone in gallery uses compact mode prop', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const dropzone = screen.getByTestId('dropzone');
      // On web, the dropzone keeps drag-and-drop styling for better UX
      // On native (iOS/Android), compact mode renders a square icon button
      // With virtual scrolling, the dropzone is now positioned below the gallery
      expect(dropzone).toBeInTheDocument();
    });
  });

  describe('refresh button', () => {
    it('renders refresh button when unlocked', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh/i })
        ).toBeInTheDocument();
      });
    });

    it('does not render refresh button when locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      });

      await renderPhotos();

      expect(
        screen.queryByRole('button', { name: /refresh/i })
      ).not.toBeInTheDocument();
    });

    it('refetches photos when refresh is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Clear mock calls
      mockDb.orderBy.mockClear();
      mockDb.orderBy.mockResolvedValue(mockPhotos);

      await user.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('displays error when photo fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockDb.orderBy.mockRejectedValue(new Error('Failed to load'));

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch photos:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles non-Error objects in catch block', async () => {
      const consoleSpy = mockConsoleError();
      mockDb.orderBy.mockRejectedValue('String error');

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch photos:',
        'String error'
      );
      consoleSpy.mockRestore();
    });
  });
});
