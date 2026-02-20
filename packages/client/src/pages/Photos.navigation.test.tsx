import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { Photos } from './photos-components';

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

    it('calls onSelectPhoto on left click when provided', async () => {
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

      await user.click(screen.getByAltText('test-image.jpg'));

      expect(onSelectPhoto).toHaveBeenCalledWith('photo-1');
      expect(mockNavigate).not.toHaveBeenCalled();
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
});
