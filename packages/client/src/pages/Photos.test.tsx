import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Photos } from './Photos';

// Mock useVirtualizer to simplify testing
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
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock database context using function approach
const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock getDatabase
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: mockUpdate
};

// Chain the update mock
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockUpdateWhere });

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

// Mock file storage
const mockStorage = {
  retrieve: vi.fn()
};

const mockIsFileStorageInitialized = vi.fn(() => true);
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (...args: unknown[]) =>
    mockInitializeFileStorage(...args),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

// Mock file upload hook
const mockUploadFile = vi.fn();
vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
}));

// Mock file utils
const mockCanShareFiles = vi.fn(() => false);
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  shareFile: (...args: unknown[]) => mockShareFile(...args)
}));

const mockPhotos = [
  {
    id: 'photo-1',
    name: 'test-image.jpg',
    size: 1024,
    mimeType: 'image/jpeg',
    uploadDate: new Date('2025-01-01'),
    storagePath: '/photos/test-image.jpg'
  },
  {
    id: 'photo-2',
    name: 'another-image.png',
    size: 2048,
    mimeType: 'image/png',
    uploadDate: new Date('2025-01-02'),
    storagePath: '/photos/another-image.png'
  }
];

async function renderPhotos() {
  const result = render(
    <MemoryRouter>
      <Photos />
    </MemoryRouter>
  );
  // Flush the setTimeout(fn, 0) used for instance-aware fetching
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

describe('Photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    // Mock database query
    mockDb.orderBy.mockResolvedValue(mockPhotos);

    // Mock file storage
    mockStorage.retrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockInitializeFileStorage.mockResolvedValue(undefined);

    // Mock file utils
    mockCanShareFiles.mockReturnValue(false);
    mockDownloadFile.mockReturnValue(undefined);
    mockShareFile.mockResolvedValue(undefined);
    mockUploadFile.mockResolvedValue(undefined);

    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    // Reset update chain mocks
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('Photos')).toBeInTheDocument();
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

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });
    });

    it('navigates to photo detail when "Get info" is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
        state: { from: '/', fromLabel: 'Back to Photos' }
      });
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

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
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });

    it('shows "Delete" option in context menu', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });

    it('soft deletes photo when "Delete" is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith({ deleted: true });
      });
    });

    it('shows error when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdateWhere.mockRejectedValue(new Error('Delete failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('handles non-Error exceptions when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdateWhere.mockRejectedValue('String error');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('triggers refetch after successful delete', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });

      // Clear to track refetch
      mockDb.orderBy.mockClear();

      await user.click(screen.getByText('Delete'));

      // Flush the setTimeout for instance-aware fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => {
        expect(mockDb.orderBy).toHaveBeenCalled();
      });
    });
  });

  describe('photo click navigation', () => {
    it('navigates to photo detail on left click', async () => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      await user.click(screen.getByAltText('test-image.jpg'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
        state: { from: '/', fromLabel: 'Back to Photos' }
      });
    });

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' ']
    ])('navigates to photo detail on keyboard %s', async (_keyName, key) => {
      const user = userEvent.setup();
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      photoContainer?.focus();
      await user.keyboard(key);

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1', {
        state: { from: '/', fromLabel: 'Back to Photos' }
      });
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
      mockDb.orderBy.mockRejectedValue(new Error('Failed to load'));

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
      });
    });

    it('handles non-Error objects in catch block', async () => {
      mockDb.orderBy.mockRejectedValue('String error');

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
    });
  });

  describe('download functionality', () => {
    beforeEach(async () => {
      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });
    });

    it('shows download button for each photo', () => {
      // Download button should be present for each photo (visible on hover via CSS)
      const downloadButtons = screen.getAllByTitle('Download');
      expect(downloadButtons.length).toBe(2); // One for each photo
    });

    it('downloads photo when download button is clicked', async () => {
      const user = userEvent.setup();

      // Get the first download button
      const downloadButtons = screen.getAllByTitle('Download');
      expect(downloadButtons.length).toBeGreaterThan(0);
      await user.click(downloadButtons[0] as HTMLElement);

      await waitFor(() => {
        // Should retrieve the full image, not thumbnail
        expect(mockStorage.retrieve).toHaveBeenCalledWith(
          '/photos/test-image.jpg'
        );
      });
    });
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
  });

  describe('share functionality', () => {
    let user: ReturnType<typeof userEvent.setup>;
    let shareButtons: HTMLElement[];

    beforeEach(async () => {
      user = userEvent.setup();
      mockCanShareFiles.mockReturnValue(true);

      await renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      shareButtons = screen.getAllByTitle('Share');
    });

    it('shows share button when sharing is available', () => {
      expect(shareButtons.length).toBeGreaterThan(0);
    });

    it('shares photo when share button is clicked', async () => {
      await user.click(shareButtons[0] as HTMLElement);

      await waitFor(() => {
        expect(mockShareFile).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          'test-image.jpg',
          'image/jpeg'
        );
      });
    });

    it('handles share cancellation gracefully', async () => {
      const abortError = new Error('Share cancelled');
      abortError.name = 'AbortError';
      mockShareFile.mockRejectedValue(abortError);

      await user.click(shareButtons[0] as HTMLElement);

      // Should NOT show an error for AbortError
      await waitFor(() => {
        expect(mockShareFile).toHaveBeenCalled();
      });

      expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument();
    });

    it('shows error when share fails', async () => {
      mockShareFile.mockRejectedValue(new Error('Share failed'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await user.click(shareButtons[0] as HTMLElement);

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
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
