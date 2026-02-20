import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindow } from './PhotosWindow';
import { createDefaultProps, setupMocks } from './PhotosWindow.testSetup';

// Hoisted mock variables - these are available before vi.mock runs
const {
  mockWindowOpenRequest,
  mockUseDatabaseContext,
  mockUploadFile,
  mockAddPhotoToAlbum
} = vi.hoisted(() => ({
  mockWindowOpenRequest: vi.fn(),
  mockUseDatabaseContext: vi.fn(),
  mockUploadFile: vi.fn(),
  mockAddPhotoToAlbum: vi.fn()
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: () => mockWindowOpenRequest(),
  useWindowManagerActions: () => ({
    openWindow: vi.fn()
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();
  return {
    ...actual,
    DesktopFloatingWindow: ({
      children
    }: {
      children: React.ReactNode;
    }) => <div data-testid="floating-window">{children}</div>,
    useWindowRefresh: () => ({
      refreshToken: 0,
      triggerRefresh: vi.fn()
    })
  };
});

vi.mock('./PhotosWindowMenuBar', () => ({
  PhotosWindowMenuBar: ({
    onUpload
  }: {
    onUpload: () => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onUpload} data-testid="upload-button">
        Upload
      </button>
    </div>
  )
}));

vi.mock('./PhotosWindowContent', () => ({
  PhotosWindowContent: () => (
    <div data-testid="photos-content">Photos Content</div>
  )
}));

vi.mock('./PhotosWindowDetail', () => ({
  PhotosWindowDetail: () => <div data-testid="photos-detail">Photos Detail</div>
}));

vi.mock('./PhotosWindowTableView', () => ({
  PhotosWindowTableView: () => (
    <div data-testid="photos-table-content">Photos Table Content</div>
  )
}));

vi.mock('./PhotosWindowThumbnailView', () => ({
  PhotosWindowThumbnailView: () => (
    <div data-testid="photos-thumbnail-content">Photos Thumbnail Content</div>
  )
}));

vi.mock('./PhotosAlbumsSidebar', () => ({
  ALL_PHOTOS_ID: '__all__',
  PhotosAlbumsSidebar: ({
    selectedAlbumId,
    onAlbumSelect,
    onDropToAlbum
  }: {
    selectedAlbumId: string | null;
    onAlbumSelect: (id: string | null) => void;
    onDropToAlbum?: (
      albumId: string,
      files: File[],
      photoIds?: string[]
    ) => void | Promise<void>;
  }) => (
    <div data-testid="photos-albums-sidebar">
      <button
        type="button"
        data-testid="select-album"
        onClick={() => onAlbumSelect('test-album-id')}
      >
        Select Album
      </button>
      <span data-testid="selected-album">{selectedAlbumId}</span>
      <button
        type="button"
        data-testid="drop-photo-ids"
        onClick={() =>
          onDropToAlbum?.('test-album-id', [], ['photo-1', 'photo-2'])
        }
      >
        Drop Photo Ids
      </button>
    </div>
  )
}));

vi.mock('./usePhotoAlbums', () => ({
  usePhotoAlbums: () => ({
    albums: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn(),
    createAlbum: vi.fn(),
    renameAlbum: vi.fn(),
    deleteAlbum: vi.fn(),
    addPhotoToAlbum: mockAddPhotoToAlbum,
    removePhotoFromAlbum: vi.fn(),
    getPhotoIdsInAlbum: vi.fn()
  })
}));

vi.mock('@/hooks/vfs', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

describe('PhotosWindow upload', () => {
  const defaultProps = createDefaultProps();

  beforeEach(() => {
    setupMocks({
      mockWindowOpenRequest,
      mockUseDatabaseContext,
      mockUploadFile,
      mockAddPhotoToAlbum
    });
  });

  describe('file input handling', () => {
    it('triggers file input when upload button is clicked', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      const fileInput = screen.getByTestId('photo-file-input');
      const clickSpy = vi.spyOn(fileInput, 'click');

      await user.click(screen.getByTestId('upload-button'));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('triggers file input when control bar upload button is clicked', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      const fileInput = screen.getByTestId('photo-file-input');
      const clickSpy = vi.spyOn(fileInput, 'click');

      await user.click(screen.getByTestId('photos-window-control-upload'));

      expect(clickSpy).toHaveBeenCalled();
    });

    it('handles file input change with files', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      const fileInput = screen.getByTestId('photo-file-input');
      if (!(fileInput instanceof HTMLInputElement)) {
        throw new Error('Expected file input to be HTMLInputElement');
      }
      const file = new File(['test content'], 'test.jpg', {
        type: 'image/jpeg'
      });

      await user.upload(fileInput, file);

      await waitFor(() =>
        expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function))
      );
      expect(fileInput.value).toBe('');
    });

    it('handles file input change with no files', () => {
      render(<PhotosWindow {...defaultProps} />);

      const fileInput = screen.getByTestId('photo-file-input');
      if (!(fileInput instanceof HTMLInputElement)) {
        throw new Error('Expected file input to be HTMLInputElement');
      }

      Object.defineProperty(fileInput, 'files', {
        value: [],
        writable: true
      });

      fireEvent.change(fileInput);

      expect(fileInput.value).toBe('');
    });
  });

  describe('upload to album', () => {
    it('adds uploaded files to selected album', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      // Select an album first
      await user.click(screen.getByTestId('select-album'));

      // Verify album is selected
      await waitFor(() => {
        expect(screen.getByTestId('selected-album')).toHaveTextContent(
          'test-album-id'
        );
      });

      // Upload a file
      const fileInput = screen.getByTestId(
        'photo-file-input'
      ) as HTMLInputElement;
      const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      });

      await waitFor(() => {
        expect(mockAddPhotoToAlbum).toHaveBeenCalledWith(
          'test-album-id',
          'uploaded-file-id'
        );
      });
    });

    it('does not add to album when "All Photos" is selected', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      // By default, "All Photos" is selected (ALL_PHOTOS_ID)
      expect(screen.getByTestId('selected-album')).toHaveTextContent('__all__');

      // Upload a file
      const fileInput = screen.getByTestId(
        'photo-file-input'
      ) as HTMLInputElement;
      const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      });

      // Should NOT call addPhotoToAlbum when "All Photos" is selected
      expect(mockAddPhotoToAlbum).not.toHaveBeenCalled();
    });

    it('adds dropped existing photos to target album', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('drop-photo-ids'));

      await waitFor(() => {
        expect(mockAddPhotoToAlbum).toHaveBeenCalledWith(
          'test-album-id',
          'photo-1'
        );
        expect(mockAddPhotoToAlbum).toHaveBeenCalledWith(
          'test-album-id',
          'photo-2'
        );
      });
    });
  });
});
