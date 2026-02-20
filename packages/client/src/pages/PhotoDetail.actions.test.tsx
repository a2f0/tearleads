/**
 * PhotoDetail download and share functionality tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { PhotoDetail } from './PhotoDetail';

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock the photos sidebar
vi.mock('@/components/photos-window/PhotosAlbumsSidebar', () => ({
  ALL_PHOTOS_ID: '__all__',
  PhotosAlbumsSidebar: () => (
    <div data-testid="photos-albums-sidebar">Albums Sidebar</div>
  )
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
vi.mock('@/lib/fileUtils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename),
  shareFile: (data: Uint8Array, filename: string, mimeType: string) =>
    mockShareFile(data, filename, mimeType),
  canShareFiles: () => mockCanShareFiles()
}));

// Mock useLLM
const mockLoadModel = vi.fn();
const mockClassify = vi.fn();
vi.mock('@/hooks/llm', () => ({
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

async function renderPhotoDetail(photoId: string = 'photo-123') {
  const result = render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/photos/${photoId}`]}>
        <Routes>
          <Route path="/photos/:id" element={<PhotoDetail />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
  await waitFor(() => {
    expect(screen.queryByText('Loading photo...')).not.toBeInTheDocument();
  });
  return result;
}

describe('PhotoDetail download functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockSelect.mockReturnValue(createMockQueryChain([TEST_PHOTO]));
    mockUpdate.mockReturnValue(createMockUpdateChain());
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockRetrieve.mockResolvedValue(TEST_IMAGE_DATA);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockInitializeFileStorage.mockResolvedValue(undefined);
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
    mockDownloadFile.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

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

describe('PhotoDetail share functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
    mockSelect.mockReturnValue(createMockQueryChain([TEST_PHOTO]));
    mockUpdate.mockReturnValue(createMockUpdateChain());
    mockGetCurrentKey.mockReturnValue(TEST_ENCRYPTION_KEY);
    mockRetrieve.mockResolvedValue(TEST_IMAGE_DATA);
    mockIsFileStorageInitialized.mockReturnValue(true);
    mockInitializeFileStorage.mockResolvedValue(undefined);
    mockCanShareFiles.mockReturnValue(true);
    mockShareFile.mockResolvedValue(true);
    mockDownloadFile.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

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

    await waitFor(() => {
      expect(mockShareFile).toHaveBeenCalled();
    });

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
