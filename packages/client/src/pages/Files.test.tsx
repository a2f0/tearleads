import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Files } from './Files';

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
    measureRetrieve: mockRetrieve,
    store: mockStore
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
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

function renderFilesRaw() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Files />
      </ThemeProvider>
    </MemoryRouter>
  );
}

async function renderFiles() {
  const result = renderFilesRaw();
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading files...')).not.toBeInTheDocument();
  });
  return result;
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
      renderFilesRaw();
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
      renderFilesRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view files./i
        )
      ).toBeInTheDocument();
    });

    it('hides dropzone when locked', () => {
      renderFilesRaw();
      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderFilesRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderFilesRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when files are loaded', () => {
    it('renders file list with names', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });
    });

    it('renders file sizes', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText(/1 KB/)).toBeInTheDocument();
        expect(screen.getByText(/2 KB/)).toBeInTheDocument();
      });
    });

    it('shows file count', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText(/2 files$/)).toBeInTheDocument();
      });
    });

    it('renders page title', async () => {
      await renderFiles();
      expect(screen.getByText('Files')).toBeInTheDocument();
    });

    it('renders Refresh button', async () => {
      await renderFiles();
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  describe('thumbnail display', () => {
    it('attempts to load thumbnail for files with thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Verify storage retrieve was called for the thumbnail
      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/files/photo-thumb.jpg',
          expect.any(Function)
        );
      });
    });

    it('does not load thumbnail for files without thumbnailPath', async () => {
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      await renderFiles();

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
      await renderFiles();

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
      const { unmount } = await renderFiles();

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
      await renderFiles();

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
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      expect(screen.queryByText('deleted.jpg')).not.toBeInTheDocument();
    });

    it('shows deleted files when toggle is enabled', async () => {
      const user = userEvent.setup();
      await renderFiles();

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
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      mockSelect.mockClear();

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockSelect).toHaveBeenCalled();
      });
    });
  });

  describe('file actions', () => {
    it('navigates to photo detail when image card is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click on the file name to navigate to detail view
      await user.click(screen.getByText('photo.jpg'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/file-1', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('navigates to documents when PDF file card is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      // Click on the file name - should navigate to documents for PDFs
      await user.click(screen.getByText('document.pdf'));

      expect(mockNavigate).toHaveBeenCalledWith('/documents/file-2', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('renders Download button for non-deleted files', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Download').length).toBeGreaterThan(0);
      });
    });

    it('renders Delete button for non-deleted files', async () => {
      await renderFiles();

      await waitFor(() => {
        expect(screen.getAllByTitle('Delete').length).toBeGreaterThan(0);
      });
    });

    it('renders Restore button for deleted files', async () => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));
      await renderFiles();

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
      await renderFiles();

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

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('Database error')).toBeInTheDocument();
      });
    });
  });

  describe('upload success badge', () => {
    it('does not show success badge initially', async () => {
      // Success badge should not be present initially for existing files
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Initially, no success badge should be present
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });

  describe('download functionality', () => {
    it('downloads file when Download button is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/files/document.pdf',
          expect.any(Function)
        );
        expect(mockDownloadFile).toHaveBeenCalled();
      });
    });

    it('initializes file storage if not initialized before download', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockIsFileStorageInitialized.mockReturnValue(false);
      mockRetrieve.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalled();
      });
    });

    it('displays error when download fails', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITHOUT_THUMBNAIL])
      );
      mockRetrieve.mockRejectedValue(new Error('Download failed'));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Download'));

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
      });
    });
  });

  describe('delete functionality', () => {
    it('soft deletes file when Delete button is clicked', async () => {
      const user = userEvent.setup();
      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Click delete on the first file
      const deleteButtons = screen.getAllByTitle('Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);
      const firstDeleteButton = deleteButtons[0];
      if (firstDeleteButton) {
        await user.click(firstDeleteButton);
      }

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('displays error when delete fails', async () => {
      const user = userEvent.setup();
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Delete failed'))
        })
      });

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);
      const firstDeleteButton = deleteButtons[0];
      if (firstDeleteButton) {
        await user.click(firstDeleteButton);
      }

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
    });
  });

  describe('restore functionality', () => {
    it('restores deleted file when Restore button is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));

      await renderFiles();

      // Enable show deleted toggle
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Restore'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
      });
    });

    it('displays error when restore fails', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Restore failed'))
        })
      });

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByTitle('Restore')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Restore'));

      await waitFor(() => {
        expect(screen.getByText('Restore failed')).toBeInTheDocument();
      });
    });
  });

  describe('audio file display', () => {
    const TEST_AUDIO_FILE = {
      id: 'audio-1',
      name: 'song.mp3',
      size: 5000,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-16'),
      storagePath: '/files/song.mp3',
      thumbnailPath: null,
      deleted: false
    };

    const TEST_DELETED_AUDIO_FILE = {
      id: 'audio-2',
      name: 'deleted-song.mp3',
      size: 3000,
      mimeType: 'audio/mpeg',
      uploadDate: new Date('2024-01-15'),
      storagePath: '/files/deleted-song.mp3',
      thumbnailPath: null,
      deleted: true
    };

    it('renders music icon for audio files', async () => {
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('song.mp3')).toBeInTheDocument();
      });

      // Should show music icon (not FileIcon)
      const musicIcon = document.querySelector('.lucide-music');
      expect(musicIcon).toBeInTheDocument();
    });

    it('navigates to audio detail when audio file is clicked', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_AUDIO_FILE]));

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('song.mp3')).toBeInTheDocument();
      });

      // Click on the audio file name to navigate to detail view
      await user.click(screen.getByText('song.mp3'));

      expect(mockNavigate).toHaveBeenCalledWith('/audio/audio-1', {
        state: { from: '/', fromLabel: 'Back to Files' }
      });
    });

    it('does not navigate when clicking on deleted audio file', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_DELETED_AUDIO_FILE])
      );

      await renderFiles();

      // Enable show deleted toggle
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByText('deleted-song.mp3')).toBeInTheDocument();
      });

      // Click on the deleted audio file - should NOT navigate because it's deleted
      await user.click(screen.getByText('deleted-song.mp3'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('file upload progress', () => {
    it('renders dropzone for file uploads', async () => {
      await renderFiles();

      const dropzone = screen.getByTestId('dropzone');
      expect(dropzone).toBeInTheDocument();

      // Verify dropzone has the expected structure
      expect(screen.getByText(/Drag and drop files here/i)).toBeInTheDocument();
    });

    it('hides dropzone when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderFilesRaw();

      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });
  });

  describe('recently uploaded badge', () => {
    it('does not show success badge for existing files', async () => {
      // Success badge only appears for newly uploaded files tracked in recentlyUploadedIds
      // Existing files in the database don't have this badge
      mockSelect.mockReturnValue(
        createMockQueryChain([TEST_FILE_WITH_THUMBNAIL])
      );

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      });

      // Existing files don't have the success badge
      expect(
        screen.queryByTestId('upload-success-badge')
      ).not.toBeInTheDocument();
    });
  });

  describe('file upload flow', () => {
    it('does not process uploads when database is locked', async () => {
      const mockUploadFile = vi.fn();
      vi.mocked(await import('@/hooks/useFileUpload')).useFileUpload = vi
        .fn()
        .mockReturnValue({
          uploadFile: mockUploadFile
        });

      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null,
        isSetUp: true,
        hasPersistedSession: false,
        unlock: vi.fn(),
        restoreSession: vi.fn()
      });

      renderFilesRaw();

      // Dropzone should not be present when locked
      expect(screen.queryByTestId('dropzone')).not.toBeInTheDocument();
    });
  });

  describe('error handling edge cases', () => {
    it('displays error when encryption key is not available', async () => {
      mockGetCurrentKey.mockReturnValue(null);

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('Database not unlocked')).toBeInTheDocument();
      });
    });

    it('displays error when no active instance', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false,
        currentInstanceId: null
      });
      mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);

      await renderFiles();

      await waitFor(() => {
        expect(screen.getByText('No active instance')).toBeInTheDocument();
      });
    });
  });

  describe('deleted image file behavior', () => {
    it('does not navigate when clicking on deleted image file', async () => {
      const user = userEvent.setup();
      mockSelect.mockReturnValue(createMockQueryChain([TEST_DELETED_FILE]));

      await renderFiles();

      // Enable show deleted toggle
      await waitFor(() => {
        expect(screen.getByRole('switch')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(screen.getByText('deleted.jpg')).toBeInTheDocument();
      });

      // Click on the deleted file - should NOT navigate because it's deleted
      await user.click(screen.getByText('deleted.jpg'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
