/**
 * Photos upload and error handling tests.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/consoleMocks';
import { Photos } from './photos-components';

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
vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  initializeFileStorage: vi.fn(),
  getFileStorage: vi.fn(() => mockStorage),
  createRetrieveLogger: () => vi.fn()
}));

const mockUploadFile = vi.fn();
vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
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
  mockUploadFile.mockResolvedValue(undefined);
  global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
  global.URL.revokeObjectURL = vi.fn();
}

describe('Photos file upload', () => {
  let user: ReturnType<typeof userEvent.setup>;
  let input: HTMLElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    setupDefaultMocks();
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

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

describe('Photos error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

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
