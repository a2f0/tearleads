import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoDetail } from './PhotoDetail';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the database
const mockSelect = vi.fn();
vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect
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
const mockIsFileStorageInitialized = vi.fn();
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  getFileStorage: () => ({
    retrieve: mockRetrieve
  }),
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (key: Uint8Array) => mockInitializeFileStorage(key)
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
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
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
        expect(mockRetrieve).toHaveBeenCalledWith('/photos/test-photo.jpg');
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
    });
  });

  describe('share functionality', () => {
    it('shares file when share button is clicked', async () => {
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(mockRetrieve).toHaveBeenCalledWith('/photos/test-photo.jpg');
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
      mockShareFile.mockRejectedValue(new Error('Share failed'));
      const user = userEvent.setup();
      await renderPhotoDetail();

      expect(screen.getByTestId('share-button')).toBeInTheDocument();

      await user.click(screen.getByTestId('share-button'));

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
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

      const backLink = screen.getByText('Back to Photos');
      expect(backLink).toBeInTheDocument();
      expect(backLink.closest('a')).toHaveAttribute('href', '/photos');
    });
  });
});
