/**
 * Photos download, share, and storage tests.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Photos } from './Photos';

// Mocks must be defined in each test file (hoisted)
vi.mock('@/components/photos-window/PhotosAlbumsSidebar', () => ({
  ALL_PHOTOS_ID: '__all__',
  PhotosAlbumsSidebar: vi.fn(() => <div data-testid="photos-albums-sidebar" />)
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
  return { ...actual, useNavigate: () => vi.fn() };
});

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn(),
  update: vi.fn()
};

vi.mock('@/db', () => ({ getDatabase: vi.fn(() => mockDb) }));
vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

const mockStorage = { retrieve: vi.fn() };
const mockIsFileStorageInitialized = vi.fn(() => true);
const mockInitializeFileStorage = vi.fn();
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => mockIsFileStorageInitialized(),
  initializeFileStorage: (...args: unknown[]) =>
    mockInitializeFileStorage(...args),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() })
}));

const mockCanShareFiles = vi.fn(() => false);
const mockDownloadFile = vi.fn();
const mockShareFile = vi.fn();
vi.mock('@/lib/fileUtils', () => ({
  canShareFiles: () => mockCanShareFiles(),
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  shareFile: (...args: unknown[]) => mockShareFile(...args)
}));

vi.mock('@/lib/llmRuntime', () => ({
  setAttachedImage: vi.fn()
}));

vi.mock('@/lib/chatAttachments', () => ({
  uint8ArrayToDataUrl: vi.fn()
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

async function renderPhotos(
  props: Partial<ComponentProps<typeof Photos>> = {}
) {
  const result = render(
    <MemoryRouter>
      <Photos {...props} />
    </MemoryRouter>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

function setupDefaultMocks() {
  mockUseDatabaseContext.mockReturnValue({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  });
  mockDb.orderBy.mockResolvedValue(mockPhotos);
  mockStorage.retrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockIsFileStorageInitialized.mockReturnValue(true);
  mockInitializeFileStorage.mockResolvedValue(undefined);
  mockCanShareFiles.mockReturnValue(false);
  mockDownloadFile.mockReturnValue(undefined);
  mockShareFile.mockResolvedValue(undefined);
  global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
  global.URL.revokeObjectURL = vi.fn();
}

describe('Photos download functionality', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultMocks();
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

describe('Photos share functionality', () => {
  let user: ReturnType<typeof userEvent.setup>;
  let shareButtons: HTMLElement[];

  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultMocks();
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

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await user.click(shareButtons[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Share failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});

describe('Photos storage initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

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

describe('Photos thumbnail loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

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

    expect(mockStorage.retrieve).toHaveBeenCalledWith('/photos/test-image.jpg');
  });

  it('skips photos that fail to load', async () => {
    // First photo fails, second succeeds
    mockStorage.retrieve
      .mockRejectedValueOnce(new Error('Load failed'))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
