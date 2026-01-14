import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { PhotoDetail } from './PhotoDetail';

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

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock the key manager
const mockGetCurrentKey = vi.fn();
vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: mockGetCurrentKey
  })
}));

// Mock file storage
const mockRetrieve = vi.fn();
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve,
    measureRetrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key),
  createRetrieveLogger: () => vi.fn()
}));

// Mock file-utils
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
const mockCanShareFiles = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

// Mock useLLM
const mockLoadModel = vi.fn();
const mockClassify = vi.fn();
vi.mock('@/hooks/useLLM', () => ({
  useLLM: () => ({
    loadedModel: null,
    isClassifying: false,
    loadModel: mockLoadModel,
    classify: mockClassify,
    isLoading: false,
    loadProgress: null
  })
}));

const TEST_PHOTO = {
  id: 'photo-123',
  name: 'test-photo.jpg',
  size: 1024,
  mimeType: 'image/jpeg',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/photos/test-photo.jpg'
};

const TEST_IMAGE_DATA = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
const TEST_ENCRYPTION_KEY = new Uint8Array([1, 2, 3, 4]);

function createMockQueryChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result)
      })
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

function renderPhotoDetailRaw(photoId: string = 'photo-123') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/photos/${photoId}`]}>
        <Routes>
          <Route path="/photos/:id" element={<PhotoDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function renderPhotoDetail(photoId: string = 'photo-123') {
  const result = renderPhotoDetailRaw(photoId);
  // Wait for initial async effects to complete
  await waitFor(() => {
    expect(screen.queryByText('Loading photo...')).not.toBeInTheDocument();
  });
  return result;
}

describe('PhotoDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for unlocked database with photo
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockRetrieve.mockResolvedValue(TEST_IMAGE_DATA);
    mockSelect.mockReturnValue(createMockQueryChain([TEST_PHOTO]));
    mockUpdate.mockReturnValue(createMockUpdateChain());
    mockNavigate.mockClear();
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
    mockLoadModel.mockResolvedValue(undefined);
    mockClassify.mockResolvedValue({
      labels: ['passport', 'drivers license'],
      scores: [0.8, 0.2]
    });
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
      renderPhotoDetailRaw();
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
      renderPhotoDetailRaw();
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Database is locked. Enter your password to view this photo./i
        )
      ).toBeInTheDocument();
    });

    it('shows password input for unlocking', () => {
      renderPhotoDetailRaw();
      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('shows unlock button', () => {
      renderPhotoDetailRaw();
      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });
  });

  describe('when photo is loaded', () => {
    it('renders photo name', async () => {
      await renderPhotoDetail();

      expect(screen.getByText('test-photo.jpg')).toBeInTheDocument();
    });

    it('renders photo details', async () => {
      await renderPhotoDetail();

      expect(screen.getByText('image/jpeg')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });

    it('renders download button', async () => {
      await renderPhotoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
      expect(screen.getByText('Download')).toBeInTheDocument();
    });

    it('renders share button when Web Share API is supported', async () => {
      mockCanShareFiles.mockReturnValue(true);
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    it('hides share button when Web Share API is not supported', async () => {
      mockCanShareFiles.mockReturnValue(false);
      await renderPhotoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();
      expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
    });
  });

  describe('download functionality', () => {
    it('downloads file when download button is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/photos/test-photo.jpg',
          expect.any(Function)
        );
        expect(mockDownloadFile).toHaveBeenCalledWith(
          TEST_IMAGE_DATA,
          'test-photo.jpg'
        );
      });
    });

    it('initializes file storage if not initialized', async () => {
      mockIsFileStorageInitialized.mockReturnValue(false);
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(mockInitializeFileStorage).toHaveBeenCalledWith(
          TEST_ENCRYPTION_KEY
        );
      });
    });

    it('shows error when download fails', async () => {
      const consoleSpy = mockConsoleError();
      // First call succeeds (photo load), second call fails (download)
      mockRetrieve
        .mockResolvedValueOnce(TEST_IMAGE_DATA)
        .mockRejectedValueOnce(new Error('Storage read failed'));
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('download-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('download-button'));

      await waitFor(() => {
        expect(screen.getByText('Storage read failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to download photo:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('share functionality', () => {
    it('shares file when share button is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith(
          '/photos/test-photo.jpg',
          expect.any(Function)
        );
        expect(mockShareFile).toHaveBeenCalledWith(
          TEST_IMAGE_DATA,
          'test-photo.jpg',
          'image/jpeg'
        );
      });
    });

    it('handles share cancellation gracefully', async () => {
      const abortError = new Error('User cancelled');
      abortError.name = 'AbortError';
      mockShareFile.mockRejectedValue(abortError);

      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      // Wait for the action to complete
      await waitFor(() => {
        expect(mockShareFile).toHaveBeenCalled();
      });

      // Should not show error for AbortError
      expect(screen.queryByText('User cancelled')).not.toBeInTheDocument();
    });

    it('shows error when share fails', async () => {
      const consoleSpy = mockConsoleError();
      mockShareFile.mockRejectedValue(new Error('Share failed'));
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to share photo:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when sharing is not supported on device', async () => {
      mockShareFile.mockResolvedValue(false);
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(
          screen.getByText('Sharing is not supported on this device')
        ).toBeInTheDocument();
      });
    });
  });

  describe('photo not found', () => {
    beforeEach(() => {
      mockSelect.mockReturnValue(createMockQueryChain([]));
    });

    it('shows not found error', async () => {
      await renderPhotoDetail();

      expect(screen.getByText('Photo not found')).toBeInTheDocument();
    });
  });

  describe('back navigation', () => {
    it('renders back link to photos page', async () => {
      await renderPhotoDetail();

      const backLink = screen.getByTestId('back-link');
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/photos');
      expect(backLink).toHaveTextContent('Back to Photos');
    });
  });

  describe('classification functionality', () => {
    it('renders classify button', async () => {
      await renderPhotoDetail();

      expect(screen.getByTestId('classify-button')).toBeInTheDocument();
      expect(screen.getByText('Classify Document')).toBeInTheDocument();
    });

    it('loads model and classifies when classify button is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('classify-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('classify-button'));

      await waitFor(() => {
        expect(mockLoadModel).toHaveBeenCalledWith(
          'Xenova/clip-vit-base-patch32'
        );
        expect(mockClassify).toHaveBeenCalled();
      });
    });

    it('displays classification results', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      await user.click(screen.getByTestId('classify-button'));

      await waitFor(() => {
        expect(screen.getByText('Document Classification')).toBeInTheDocument();
        expect(screen.getByText('passport')).toBeInTheDocument();
        expect(screen.getByText('drivers license')).toBeInTheDocument();
        expect(screen.getByText('80.0%')).toBeInTheDocument();
        expect(screen.getByText('20.0%')).toBeInTheDocument();
      });
    });

    it('shows error when classification fails', async () => {
      const consoleSpy = mockConsoleError();
      mockClassify.mockRejectedValue(new Error('Classification failed'));
      const user = userEvent.setup();
      await renderPhotoDetail();

      await user.click(screen.getByTestId('classify-button'));

      await waitFor(() => {
        expect(screen.getByText('Classification failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to classify photo:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('delete functionality', () => {
    it('renders delete button', async () => {
      await renderPhotoDetail();

      expect(screen.getByTestId('delete-button')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('opens delete dialog when delete button is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      await user.click(screen.getByTestId('delete-button'));

      expect(screen.getByTestId('delete-photo-dialog')).toBeInTheDocument();
      expect(screen.getByText('Delete Photo')).toBeInTheDocument();
      expect(
        screen.getByText(/Are you sure you want to delete/i)
      ).toBeInTheDocument();
    });

    it('closes dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      await user.click(screen.getByTestId('delete-button'));
      expect(screen.getByTestId('delete-photo-dialog')).toBeInTheDocument();

      await user.click(screen.getByTestId('cancel-delete-photo-button'));

      expect(
        screen.queryByTestId('delete-photo-dialog')
      ).not.toBeInTheDocument();
    });

    it('deletes photo and navigates when delete is confirmed', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      await user.click(screen.getByTestId('delete-button'));
      await user.click(screen.getByTestId('confirm-delete-photo-button'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/photos');
      });
    });
  });

  describe('URL lifecycle', () => {
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
    let mockCreateObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockRevokeObjectURL = vi.fn();
      mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url');
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('revokes object URLs when component unmounts', async () => {
      const { unmount } = await renderPhotoDetail();

      // URL should have been created
      expect(mockCreateObjectURL).toHaveBeenCalled();

      // Unmount the component
      unmount();

      // URL should be revoked
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});
