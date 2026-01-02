import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Files } from './Files';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
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
const mockStore = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    store: mockStore
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key)
}));

// Mock file-utils
const mockDownloadFile = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  computeContentHash: vi.fn().mockResolvedValue('mock-hash'),
  readFileAsUint8Array: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
}));

// Mock useFileUpload hook
vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({ id: 'new-id', isDuplicate: false })
  })
}));

const TEST_FILE_WITH_THUMBNAIL = {
  id: 'file-1',
  name: 'photo.jpg',
  size: 1024,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/files/photo.jpg',
  thumbnailPath: '/files/photo-thumb.jpg',
  deleted: false
};

const TEST_FILE_WITHOUT_THUMBNAIL = {
  id: 'file-2',
  name: 'document.pdf',
  size: 2048,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-14'),
  storagePath: '/files/document.pdf',
  thumbnailPath: null,
  deleted: false
};

const TEST_DELETED_FILE = {
  id: 'file-3',
  name: 'deleted.jpg',
  size: 512,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-13'),
  storagePath: '/files/deleted.jpg',
  thumbnailPath: '/files/deleted-thumb.jpg',
  deleted: true
};

const TEST_THUMBNAIL_DATA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header bytes
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue(result)
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

// Mock URL.createObjectURL and URL.revokeObjectURL
let objectUrlCounter = 0;

function renderFiles() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Files />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    objectUrlCounter = 0;

    // Mock URL methods
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:test-${objectUrlCounter++}`;
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // Default mocks for unlocked database
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_THUMBNAIL_DATA);
    mockSelect.mockReturnValue(
      createMockQueryChain([
        TEST_FILE_WITH_THUMBNAIL,
        TEST_FILE_WITHOUT_THUMBNAIL
      ])
    );
    mockUpdate.mockReturnValue(createMockUpdateChain());
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
      renderFiles();
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
      renderFiles();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view files./i
        )
      ).toBeInTheDocument();
    });

    it('hides dropzone when locked', () => {
      renderFiles();
      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderFiles();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderFiles();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when files are loaded', () => {
    it('renders file list with names', async () => {
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });
    });

    it('renders file sizes', async () => {
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText(/1 KB/)).toBeInTheDocument();
        expect(screen.getByText(/2 KB/)).toBeInTheDocument();
      });
    });

    it('renders page title', () => {
      renderFiles();
      expect(screen.getByText('Files')).toBeInTheDocument();
    });

    it('renders Refresh button', () => {
      renderFiles();
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });

  describe('thumbnail display', () => {
    it('attempts to load thumbnail for files with thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Verify storage retrieve was called for the thumbnail
      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith('/files/photo-thumb.jpg');
      });
    });

    it('does not load thumbnail for files without thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      // Should not call retrieve since there's no thumbnail
      expect(mockRetrieve).not.toHaveBeenCalled();
    });

    it('handles thumbnail load failure gracefully', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      mockRetrieve.mockRejectedValue(new Error('Storage error'));
      renderFiles();

      // File should still render even if thumbnail fails
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Should not have any img elements since thumbnail failed to load
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('revokes object URLs on unmount to prevent memory leaks', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      const { unmount } = renderFiles();

      // Wait for thumbnail to load
      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(URL.createObjectURL).toHaveBeenCalled();
      });

      // Unmount the component
      unmount();

      // Verify revokeObjectURL was called for cleanup
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows empty state message when no files', async () => {
      renderFiles();

      await waitFor(() => {
        expect(
          screen.getByText(
            'No files found. Drop or select files above to upload.'
          )
        ).toBeInTheDocument();
      });
    });
  });

  describe('show deleted toggle', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(
        createMockQueryChain([
          TEST_FILE_WITH_THUMBNAIL,
          TEST_FILE_WITHOUT_THUMBNAIL,
          TEST_DELETED_FILE
        ])
      );
    });

    it('hides deleted files by default', async () => {
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      expect(screen.queryByText('deleted.jpg')).not.toBeInTheDocument();
    });

    it('shows deleted files when toggle is enabled', async () => {
      const user = userEvent.setup();
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click the toggle switch
      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('refetches files when Refresh is clicked', async () => {
      const user = userEvent.setup();
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      mockSelect.mockClear();

      await user.click(screen.getByText('Refresh'));

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });
  });

  describe('file actions', () => {
    it('renders View button only for image files', async () => {
      renderFiles();

      await waitFor(() => {
        // Only the image file (photo.jpg) should have View button
        expect(screen.getAllByTitle('View').length).toBe(1);
      });
    });

    it('does not render View button for non-image files', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      expect(screen.queryByTitle('View')).not.toBeInTheDocument();
    });

    it('navigates to photo detail when View button is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('View'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/file-1');
    });

    it('renders Download button for non-deleted files', async () => {
      renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Download').length).toBeGreaterThan(0);
      });
    });

    it('renders Delete button for non-deleted files', async () => {
      renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Delete').length).toBeGreaterThan(0);
      });
    });

    it('renders Restore button for deleted files', async () => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));
      renderFiles();

      // Enable show deleted toggle first
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByTitle('Restore')).toBeInTheDocument();
      });
    });
  });

  describe('file storage initialization', () => {
    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      renderFiles();

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY
        );
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when fetching fails', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockRejectedValue(new Error('Database error'))
        })
      });

      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });
  });

  describe('upload success badge', () => {
    it('does not show success badge initially', async () => {
      // Success badge should not be present initially for existing files
      renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Initially, no success badge should be present
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });
});
