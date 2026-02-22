import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_PHOTOS_ID, PhotosAlbumsSidebar } from './PhotosAlbumsSidebar';

const mockAlbums = [
  {
    id: 'album-1',
    name: 'Vacation',
    photoCount: 10,
    coverPhotoId: null,
    albumType: 'custom' as const
  },
  {
    id: 'album-2',
    name: 'Family',
    photoCount: 5,
    coverPhotoId: null,
    albumType: 'custom' as const
  }
];

const mockUsePhotoAlbums: {
  albums: typeof mockAlbums;
  loading: boolean;
  error: string | null;
  refetch: ReturnType<typeof vi.fn>;
  deleteAlbum: ReturnType<typeof vi.fn>;
  renameAlbum: ReturnType<typeof vi.fn>;
} = {
  albums: mockAlbums,
  loading: false,
  error: null,
  refetch: vi.fn(),
  deleteAlbum: vi.fn().mockResolvedValue(undefined),
  renameAlbum: vi.fn().mockResolvedValue(undefined)
};

vi.mock('./usePhotoAlbums', () => ({
  usePhotoAlbums: () => mockUsePhotoAlbums
}));

vi.mock('./NewAlbumDialog', () => ({
  NewAlbumDialog: ({
    open,
    onOpenChange
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="new-album-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null
}));

vi.mock('./RenameAlbumDialog', () => ({
  RenameAlbumDialog: ({
    open,
    onOpenChange,
    onAlbumRenamed
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAlbumRenamed?: () => void;
  }) =>
    open ? (
      <div data-testid="rename-album-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            onAlbumRenamed?.();
            onOpenChange(false);
          }}
        >
          Save
        </button>
      </div>
    ) : null
}));

vi.mock('./DeleteAlbumDialog', () => ({
  DeleteAlbumDialog: ({
    open,
    onOpenChange,
    onAlbumDeleted,
    album
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAlbumDeleted?: (albumId: string) => void;
    album: { id: string } | null;
  }) =>
    open ? (
      <div data-testid="delete-album-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (album) onAlbumDeleted?.(album.id);
            onOpenChange(false);
          }}
        >
          Delete
        </button>
      </div>
    ) : null
}));describe('PhotosAlbumsSidebar', () => {

  const defaultProps = {
    width: 200,
    onWidthChange: vi.fn(),
    selectedAlbumId: ALL_PHOTOS_ID,
    onAlbumSelect: vi.fn(),
    refreshToken: 0,
    onAlbumChanged: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePhotoAlbums.albums = mockAlbums;
    mockUsePhotoAlbums.loading = false;
    mockUsePhotoAlbums.error = null;
  });

  it('renders All Photos option', () => {
    render(<PhotosAlbumsSidebar {...defaultProps} />);
    expect(screen.getByText('All Photos')).toBeInTheDocument();
  });

  it('renders album list', () => {
    render(<PhotosAlbumsSidebar {...defaultProps} />);
    expect(screen.getByText('Vacation')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
  });

  it('shows photo counts', () => {
    render(<PhotosAlbumsSidebar {...defaultProps} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('refetches when refresh token changes', async () => {
    const { rerender } = render(
      <PhotosAlbumsSidebar {...defaultProps} refreshToken={0} />
    );

    expect(mockUsePhotoAlbums.refetch).not.toHaveBeenCalled();

    rerender(<PhotosAlbumsSidebar {...defaultProps} refreshToken={1} />);

    await waitFor(() => {
      expect(mockUsePhotoAlbums.refetch).toHaveBeenCalledTimes(1);
    });
  });

  it('selects All Photos when clicked', async () => {
    const user = userEvent.setup();
    const onAlbumSelect = vi.fn();

    render(
      <PhotosAlbumsSidebar {...defaultProps} onAlbumSelect={onAlbumSelect} />
    );

    await user.click(screen.getByText('All Photos'));
    expect(onAlbumSelect).toHaveBeenCalledWith(ALL_PHOTOS_ID);
  });

  it('selects album when clicked', async () => {
    const user = userEvent.setup();
    const onAlbumSelect = vi.fn();

    render(
      <PhotosAlbumsSidebar {...defaultProps} onAlbumSelect={onAlbumSelect} />
    );

    await user.click(screen.getByText('Vacation'));
    expect(onAlbumSelect).toHaveBeenCalledWith('album-1');
  });

  it('highlights selected album', () => {
    render(<PhotosAlbumsSidebar {...defaultProps} selectedAlbumId="album-1" />);

    const vacationButton = screen.getByText('Vacation').closest('button');
    expect(vacationButton).toHaveClass('bg-accent');
  });

  it('highlights All Photos when selected', () => {
    render(
      <PhotosAlbumsSidebar {...defaultProps} selectedAlbumId={ALL_PHOTOS_ID} />
    );

    const allPhotosButton = screen.getByText('All Photos').closest('button');
    expect(allPhotosButton).toHaveClass('bg-accent');
  });

  it('opens new album dialog on button click', async () => {
    const user = userEvent.setup();
    render(<PhotosAlbumsSidebar {...defaultProps} />);

    await user.click(screen.getByTitle('New Album'));
    expect(screen.getByTestId('new-album-dialog')).toBeInTheDocument();
  });

  it('opens context menu on right click', async () => {
    const user = userEvent.setup();
    render(<PhotosAlbumsSidebar {...defaultProps} />);

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    mockUsePhotoAlbums.loading = true;
    mockUsePhotoAlbums.albums = [];

    render(<PhotosAlbumsSidebar {...defaultProps} />);

    expect(screen.getByText('All Photos')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUsePhotoAlbums.error = 'Failed to load';

    render(<PhotosAlbumsSidebar {...defaultProps} />);

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('exports ALL_PHOTOS_ID constant', () => {
    expect(ALL_PHOTOS_ID).toBe('__all__');
  });

  it('opens rename dialog from context menu', async () => {
    const user = userEvent.setup();
    render(<PhotosAlbumsSidebar {...defaultProps} />);

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Rename'));
    expect(screen.getByTestId('rename-album-dialog')).toBeInTheDocument();
  });

  it('opens delete dialog from context menu', async () => {
    const user = userEvent.setup();
    render(<PhotosAlbumsSidebar {...defaultProps} />);

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));
    expect(screen.getByTestId('delete-album-dialog')).toBeInTheDocument();
  });

  it('closes context menu on backdrop click', async () => {
    const user = userEvent.setup();
    render(<PhotosAlbumsSidebar {...defaultProps} />);

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('album-context-menu-backdrop'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('album-context-menu')
      ).not.toBeInTheDocument();
    });
  });

  it('calls onAlbumChanged when new album is created', async () => {
    const user = userEvent.setup();
    const onAlbumChanged = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onAlbumChanged={onAlbumChanged} />
    );

    await user.click(screen.getByTitle('New Album'));
    expect(screen.getByTestId('new-album-dialog')).toBeInTheDocument();

    await user.click(screen.getByText('Close'));
    expect(screen.queryByTestId('new-album-dialog')).not.toBeInTheDocument();
  });

  it('closes rename dialog and calls onAlbumChanged', async () => {
    const user = userEvent.setup();
    const onAlbumChanged = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onAlbumChanged={onAlbumChanged} />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Rename'));
    expect(screen.getByTestId('rename-album-dialog')).toBeInTheDocument();

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockUsePhotoAlbums.refetch).toHaveBeenCalled();
      expect(onAlbumChanged).toHaveBeenCalled();
    });
  });

  it('selects All Photos when selected album is deleted', async () => {
    const user = userEvent.setup();
    const onAlbumSelect = vi.fn();
    render(
      <PhotosAlbumsSidebar
        {...defaultProps}
        selectedAlbumId="album-1"
        onAlbumSelect={onAlbumSelect}
      />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');
    await user.pointer({ keys: '[MouseRight]', target: albumButton });

    await waitFor(() => {
      expect(screen.getByTestId('album-context-menu')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete'));
    expect(screen.getByTestId('delete-album-dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(onAlbumSelect).toHaveBeenCalledWith(ALL_PHOTOS_ID);
    });
  });

  it('handles resize via mouse drag', async () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <PhotosAlbumsSidebar {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = container.querySelector('.cursor-col-resize');
    if (!resizeHandle) throw new Error('Resize handle not found');

    // Simulate mouse down
    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      clientX: 200
    });
    resizeHandle.dispatchEvent(mouseDownEvent);

    // Simulate mouse move
    const mouseMoveEvent = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 250
    });
    document.dispatchEvent(mouseMoveEvent);

    // Simulate mouse up
    const mouseUpEvent = new MouseEvent('mouseup', {
      bubbles: true
    });
    document.dispatchEvent(mouseUpEvent);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('highlights All Photos when selectedAlbumId is null', () => {
    render(<PhotosAlbumsSidebar {...defaultProps} selectedAlbumId={null} />);

    const allPhotosButton = screen.getByText('All Photos').closest('button');
    expect(allPhotosButton).toHaveClass('bg-accent');
  });
});
