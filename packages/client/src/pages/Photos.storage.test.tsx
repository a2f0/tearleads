import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Photos } from './Photos';
import {
  mockCanShareFiles,
  mockDb,
  mockDownloadFile,
  mockInitializeFileStorage,
  mockIsFileStorageInitialized,
  mockNavigate,
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

  describe('thumbnail loading', () => {
    it('uses thumbnail path when available', async () => {
      const photosWithThumbnails = [
        {
          id: 'photo-1',
          name: 'test-image.jpg',
          size: 1024,
          mimeType: 'image/jpeg',
          uploadDate: new Date('2025-01-01'),
          storagePath: '/photos/test-image.jpg',
          thumbnailPath: '/thumbnails/test-image.jpg'
        }
      ];
      mockDb.orderBy.mockResolvedValue(photosWithThumbnails);

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Should use thumbnail path
      expect(mockStorage.retrieve).toHaveBeenCalledWith(
        '/thumbnails/test-image.jpg'
      );
    });

    it('falls back to storage path when no thumbnail exists', async () => {
      const photosWithoutThumbnails = [
        {
          id: 'photo-1',
          name: 'test-image.jpg',
          size: 1024,
          mimeType: 'image/jpeg',
          uploadDate: new Date('2025-01-01'),
          storagePath: '/photos/test-image.jpg',
          thumbnailPath: null
        }
      ];
      mockDb.orderBy.mockResolvedValue(photosWithoutThumbnails);

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      expect(mockStorage.retrieve).toHaveBeenCalledWith(
        '/photos/test-image.jpg'
      );
    });

    it('skips photos that fail to load', async () => {
      // First photo fails, second succeeds
      mockStorage.retrieve
        .mockRejectedValueOnce(new Error('Load failed'))
        .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderPhotos();

      await waitFor(() => {
        // Only the second photo should be displayed
        expect(screen.getByAltText('another-image.png')).toBeInTheDocument();
      });

      // First photo should not be rendered
      expect(screen.queryByAltText('test-image.jpg')).not.toBeInTheDocument();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load photo test-image.jpg:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('file upload', () => {
    let user: ReturnType<typeof userEvent.setup>;
    let input: HTMLElement;

    beforeEach(async () => {
      user = userEvent.setup();
      mockDb.orderBy.mockResolvedValue([]);

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByTestId('dropzone-input')).toBeInTheDocument();
      });

      input = screen.getByTestId('dropzone-input');
    });

    it('uploads valid image files', async () => {
      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      });
    });

    it('rejects unsupported file types with image/* MIME type', async () => {
      // Use image/tiff which passes the accept="image/*" filter but is not in the allowed list
      const file = new File(['test content'], 'test.tiff', {
        type: 'image/tiff'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText(/unsupported format.*Supported:.*JPEG.*PNG.*GIF/i)
        ).toBeInTheDocument();
      });

      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it('shows upload errors', async () => {
      mockUploadFile.mockRejectedValue(new Error('Upload failed'));

      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg'
      });

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/Upload failed/)).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('supports multiple file uploads', async () => {
      const files = [
        new File(['content1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['content2'], 'test2.png', { type: 'image/png' })
      ];

      await user.upload(input, files);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledTimes(2);
      });
    });

    it('shows uploading state during upload', async () => {
      // Make upload take some time - use object to avoid TS2454
      const uploadControl = { resolve: () => {} };
      mockUploadFile.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            uploadControl.resolve = resolve;
          })
      );

      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg'
      });

      await user.upload(input, file);

      expect(screen.getByText('Uploading...')).toBeInTheDocument();

      // Resolve upload
      uploadControl.resolve();

      await waitFor(() => {
        expect(screen.queryByText('Uploading...')).not.toBeInTheDocument();
      });
    });

    it('shows upload progress while uploading', async () => {
      let progressCallback: (progress: number) => void = () => {};
      const uploadControl = { resolve: () => {} };

      mockUploadFile.mockImplementation((_file, onProgress) => {
        progressCallback = onProgress ?? (() => {});
        return new Promise<void>((resolve) => {
          uploadControl.resolve = resolve;
        });
      });

      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg'
      });

      await user.upload(input, file);

      act(() => {
        progressCallback(42);
      });

      const progressbar = screen.getByRole('progressbar', {
        name: /upload progress/i
      });
      expect(progressbar).toHaveAttribute('aria-valuenow', '42');
      expect(screen.getByText('42%')).toBeInTheDocument();

      uploadControl.resolve();

      await waitFor(() => {
        expect(
          screen.queryByRole('progressbar', { name: /upload progress/i })
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('storage initialization', () => {
    it('initializes storage when not already initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      await renderPhotos();

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalled();
      });
    });

    it('skips storage initialization when already initialized', async () => {
      // mockIsFileStorageInitialized already returns true from parent beforeEach
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      expect(mockInitializeFileStorage).not.toHaveBeenCalled();
    });
  });

  describe('instance switching', () => {
    it('refetches photos when instance changes', async () => {
      const { rerender } = await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Clear mocks to track new calls
      mockDb.orderBy.mockClear();

      // Change the instance
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: 'new-instance'
      });

      // Re-render with the new instance context
      rerender(
        <MemoryRouter>
          <Photos />
        </MemoryRouter>
      );

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify that photos were fetched again
      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });
});
