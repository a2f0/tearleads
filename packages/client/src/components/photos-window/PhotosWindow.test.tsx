import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindow } from './PhotosWindow';

const mockWindowOpenRequests = vi.fn();
vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    windowOpenRequests: mockWindowOpenRequests(),
    openWindow: vi.fn()
  })
}));

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockUploadFile = vi.fn();

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
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
}));

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
    showDeleted
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

const mockAddPhotoToAlbum = vi.fn();

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

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

describe('PhotosWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFile.mockClear();
    mockUploadFile.mockResolvedValue({
      id: 'uploaded-file-id',
      isDuplicate: false
    });
    mockAddPhotoToAlbum.mockClear();
    mockAddPhotoToAlbum.mockResolvedValue(undefined);
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockWindowOpenRequests.mockReturnValue({});
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

  it('renders hidden file input', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photo-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('photo-file-input')).toHaveClass('hidden');
  });

  it('triggers file input when upload button is clicked', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('photo-file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('upload-button'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('calls refresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    await user.click(screen.getByTestId('refresh-button'));

    expect(screen.getByTestId('photos-content')).toBeInTheDocument();
  });

  it('handles file input change with files', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('photo-file-input');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Expected file input to be HTMLInputElement');
    }
    const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });

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

    expect(screen.getByTestId('photos-thumbnail-content')).toBeInTheDocument();
  });

  it('keeps menu bar visible in detail view', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-photo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });
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

  it('handles open request with albumId', () => {
    mockWindowOpenRequests.mockReturnValue({
      photos: { albumId: 'album-123', requestId: 1 }
    });
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photos-content')).toBeInTheDocument();
  });

  it('handles open request with photoId', async () => {
    mockWindowOpenRequests.mockReturnValue({
      photos: { photoId: 'photo-456', requestId: 1 }
    });
    render(<PhotosWindow {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
      expect(screen.getByTestId('detail-photo-id')).toHaveTextContent(
        'photo-456'
      );
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
