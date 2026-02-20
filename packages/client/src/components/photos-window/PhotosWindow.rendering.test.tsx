import { render, screen } from '@testing-library/react';
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
      <div data-testid="menu-show-deleted">{showDeleted ? 'true' : 'false'}</div>
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

describe('PhotosWindow rendering', () => {
  const defaultProps = createDefaultProps();

  beforeEach(() => {
    setupMocks({
      mockWindowOpenRequest,
      mockUseDatabaseContext,
      mockUploadFile,
      mockAddPhotoToAlbum
    });
  });

  it('renders in FloatingWindow', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays correct title', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Photos');
  });

  it('renders menu bar', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders control bar actions in list view', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(
      screen.getByTestId('photos-window-control-upload')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('photos-window-control-refresh')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('photos-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('renders photos content', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photos-content')).toBeInTheDocument();
  });

  it('wraps list content in a scrollable container', () => {
    render(<PhotosWindow {...defaultProps} />);
    const container = screen.getByTestId('photos-content').parentElement;
    expect(container).toHaveClass('overflow-auto');
    expect(container).toHaveClass('h-full');
  });

  it('renders hidden file input', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photo-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('photo-file-input')).toHaveClass('hidden');
  });

  it('shows sidebar when database is unlocked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photos-albums-sidebar')).toBeInTheDocument();
  });

  it('hides sidebar when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });
    render(<PhotosWindow {...defaultProps} />);
    expect(
      screen.queryByTestId('photos-albums-sidebar')
    ).not.toBeInTheDocument();
  });

  it('toggles showDropzone from the menu', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    expect(screen.getByTestId('menu-show-dropzone')).toHaveTextContent('false');

    await user.click(screen.getByTestId('toggle-dropzone-button'));

    expect(screen.getByTestId('menu-show-dropzone')).toHaveTextContent('true');
  });

  it('toggles showDeleted from the menu', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    expect(screen.getByTestId('menu-show-deleted')).toHaveTextContent('false');
    expect(screen.getByTestId('content-show-deleted')).toHaveTextContent(
      'false'
    );

    await user.click(screen.getByTestId('toggle-show-deleted-button'));

    expect(screen.getByTestId('menu-show-deleted')).toHaveTextContent('true');
    expect(screen.getByTestId('content-show-deleted')).toHaveTextContent(
      'true'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PhotosWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PhotosWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });
});
