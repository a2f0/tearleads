import { render, screen, waitFor } from '@testing-library/react';
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
      children,
      title,
      onClose
    }: {
      children: React.ReactNode;
      title: string;
      onClose: () => void;
    }) => (
      <div data-testid="floating-window">
        <div data-testid="window-title">{title}</div>
        <button type="button" onClick={onClose} data-testid="close-window">
          Close
        </button>
        {children}
      </div>
    )
  };
});

vi.mock('./PhotosWindowMenuBar', () => ({
  PhotosWindowMenuBar: ({
    onRefresh,
    onUpload,
    onClose,
    onViewModeChange,
    showDeleted,
    onShowDeletedChange,
    showDropzone,
    onShowDropzoneChange
  }: {
    viewMode: 'list' | 'table' | 'thumbnail';
    showDeleted: boolean;
    onShowDeletedChange: (show: boolean) => void;
    showDropzone: boolean;
    onShowDropzoneChange: (show: boolean) => void;
    onRefresh: () => void;
    onUpload: () => void;
    onClose: () => void;
    onViewModeChange: (mode: 'list' | 'table' | 'thumbnail') => void;
  }) => (
    <div data-testid="menu-bar">
      <div data-testid="menu-show-dropzone">
        {showDropzone ? 'true' : 'false'}
      </div>
      <div data-testid="menu-show-deleted">
        {showDeleted ? 'true' : 'false'}
      </div>
      <button type="button" onClick={onRefresh} data-testid="refresh-button">
        Refresh
      </button>
      <button type="button" onClick={onUpload} data-testid="upload-button">
        Upload
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('list')}
        data-testid="list-view-button"
      >
        List
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('thumbnail')}
        data-testid="thumbnail-view-button"
      >
        Thumbnail
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="table-view-button"
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => onShowDeletedChange(!showDeleted)}
        data-testid="toggle-show-deleted-button"
      >
        Toggle Deleted
      </button>
      <button
        type="button"
        onClick={() => onShowDropzoneChange(!showDropzone)}
        data-testid="toggle-dropzone-button"
      >
        Toggle Dropzone
      </button>
    </div>
  )
}));

vi.mock('./PhotosWindowContent', () => ({
  PhotosWindowContent: ({
    onSelectPhoto,
    showDeleted,
    refreshToken
  }: {
    onSelectPhoto?: (photoId: string) => void;
    refreshToken: number;
    showDeleted?: boolean;
    showDropzone?: boolean;
    onUploadFiles?: (files: File[]) => void | Promise<void>;
  }) => (
    <div data-testid="photos-content">
      <span data-testid="content-show-deleted">
        {showDeleted ? 'true' : 'false'}
      </span>
      <span data-testid="content-refresh-token">{refreshToken}</span>
      <button
        type="button"
        onClick={() => onSelectPhoto?.('photo-123')}
        data-testid="select-photo-button"
      >
        Select Photo
      </button>
      Photos Content
    </div>
  )
}));

vi.mock('./PhotosWindowDetail', () => ({
  PhotosWindowDetail: ({
    photoId,
    onBack,
    onDeleted
  }: {
    photoId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="photos-detail">
      <span data-testid="detail-photo-id">{photoId}</span>
      <button type="button" onClick={onBack} data-testid="detail-back-button">
        Back
      </button>
      <button
        type="button"
        onClick={onDeleted}
        data-testid="detail-delete-button"
      >
        Delete
      </button>
    </div>
  )
}));

vi.mock('./PhotosWindowTableView', () => ({
  PhotosWindowTableView: () => (
    <div data-testid="photos-table-content">Photos Table Content</div>
  )
}));

vi.mock('./PhotosWindowThumbnailView', () => ({
  PhotosWindowThumbnailView: ({
    onSelectPhoto,
    showDeleted
  }: {
    onSelectPhoto?: (photoId: string) => void;
    refreshToken: number;
    showDeleted?: boolean;
    showDropzone?: boolean;
  }) => (
    <div data-testid="photos-thumbnail-content">
      <span data-testid="thumbnail-show-deleted">
        {showDeleted ? 'true' : 'false'}
      </span>
      <button
        type="button"
        onClick={() => onSelectPhoto?.('photo-456')}
        data-testid="select-thumbnail-photo-button"
      >
        Select Thumbnail
      </button>
      Photos Thumbnail Content
    </div>
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

describe('PhotosWindow navigation', () => {
  const defaultProps = createDefaultProps();

  beforeEach(() => {
    setupMocks({
      mockWindowOpenRequest,
      mockUseDatabaseContext,
      mockUploadFile,
      mockAddPhotoToAlbum
    });
  });

  describe('view mode switching', () => {
    it('switches to table view when requested', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('table-view-button'));

      expect(screen.getByTestId('photos-table-content')).toBeInTheDocument();
    });

    it('switches to thumbnail view when requested', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('thumbnail-view-button'));

      expect(
        screen.getByTestId('photos-thumbnail-content')
      ).toBeInTheDocument();
    });
  });

  describe('detail view navigation', () => {
    it('keeps menu bar visible in detail view', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('select-photo-button'));

      await waitFor(() => {
        expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
        expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
      });
    });

    it('returns to content view when photo is deleted', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      // Navigate to detail view
      await user.click(screen.getByTestId('select-photo-button'));
      await waitFor(() => {
        expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
      });

      // Delete photo
      await user.click(screen.getByTestId('detail-delete-button'));

      // Should return to content view
      await waitFor(() => {
        expect(screen.queryByTestId('photos-detail')).not.toBeInTheDocument();
        expect(screen.getByTestId('photos-content')).toBeInTheDocument();
      });
    });

    it('returns to content view when control bar back is clicked', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('select-photo-button'));
      await waitFor(() => {
        expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
        expect(
          screen.getByTestId('photos-window-control-back')
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('photos-window-control-back'));

      await waitFor(() => {
        expect(screen.queryByTestId('photos-detail')).not.toBeInTheDocument();
        expect(screen.getByTestId('photos-content')).toBeInTheDocument();
      });
    });
  });

  describe('refresh functionality', () => {
    it('calls refresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      await user.click(screen.getByTestId('refresh-button'));

      expect(screen.getByTestId('photos-content')).toBeInTheDocument();
    });

    it('refreshes content when control bar refresh is clicked', async () => {
      const user = userEvent.setup();
      render(<PhotosWindow {...defaultProps} />);

      expect(screen.getByTestId('content-refresh-token')).toHaveTextContent(
        '0'
      );

      await user.click(screen.getByTestId('photos-window-control-refresh'));

      expect(screen.getByTestId('content-refresh-token')).toHaveTextContent(
        '1'
      );
    });
  });

  describe('open request handling', () => {
    it('handles open request with albumId', () => {
      mockWindowOpenRequest.mockReturnValue({
        albumId: 'album-123',
        requestId: 1
      });
      render(<PhotosWindow {...defaultProps} />);
      expect(screen.getByTestId('photos-content')).toBeInTheDocument();
    });

    it('handles open request with photoId', async () => {
      mockWindowOpenRequest.mockReturnValue({
        photoId: 'photo-456',
        requestId: 1
      });
      render(<PhotosWindow {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
        expect(screen.getByTestId('detail-photo-id')).toHaveTextContent(
          'photo-456'
        );
      });
    });
  });
});
