import { act, render, screen, waitFor } from '@testing-library/react';
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
  mockSet,
  mockSetAttachedImage,
  mockShareFile,
  mockStorage,
  mockUint8ArrayToDataUrl,
  mockUpdate,
  mockUpdateWhere,
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

describe('Photos context menu', () => {
  beforeEach(() => {
    setupPhotosTestMocks();
  });

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

  it('calls onSelectPhoto callback instead of navigating when provided', async () => {
    const user = userEvent.setup();
    const onSelectPhoto = vi.fn();

    render(
      <MemoryRouter>
        <Photos onSelectPhoto={onSelectPhoto} />
      </MemoryRouter>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });

    await waitFor(() => {
      expect(screen.getByText('Get info')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Get info'));

    expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
    expect(mockNavigate).not.toHaveBeenCalled();
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

  it('adds photo to AI chat from context menu', async () => {
    const user = userEvent.setup();
    await renderPhotos();

    await waitFor(() => {
      expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
    });

    const photo = screen.getByAltText('test-image.jpg');
    await user.pointer({ keys: '[MouseRight]', target: photo });
    await user.click(screen.getByText('Add to AI chat'));

    await waitFor(() => {
      expect(mockSetAttachedImage).toHaveBeenCalledWith(
        'data:image/jpeg;base64,test-image'
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('/chat', {
      state: { from: '/', fromLabel: 'Back to Photos' }
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

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
