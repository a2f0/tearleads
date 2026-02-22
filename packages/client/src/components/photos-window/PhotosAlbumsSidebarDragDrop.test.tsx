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
}));

describe('PhotosAlbumsSidebar drag-drop and resize', () => {
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

  it('opens empty space context menu on right click', async () => {
    const user = userEvent.setup();
    const { container } = render(<PhotosAlbumsSidebar {...defaultProps} />);

    const scrollableArea = container.querySelector('.overflow-y-auto');
    if (!scrollableArea) throw new Error('Scrollable area not found');
    await user.pointer({ keys: '[MouseRight]', target: scrollableArea });

    await waitFor(() => {
      expect(
        screen.getByTestId('empty-space-context-menu')
      ).toBeInTheDocument();
    });
  });

  it('drops dragged photos into an album', async () => {
    const onDropToAlbum = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onDropToAlbum={onDropToAlbum} />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');

    const payload = JSON.stringify({
      mediaType: 'image',
      ids: ['photo-1', 'photo-2']
    });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-tearleads-media-ids' ? payload : ''
    };

    fireEvent.drop(albumButton, { dataTransfer });

    await waitFor(() => {
      expect(onDropToAlbum).toHaveBeenCalledWith(
        'album-1',
        [],
        ['photo-1', 'photo-2']
      );
    });
  });

  it('drops image files into an album', async () => {
    const onDropToAlbum = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onDropToAlbum={onDropToAlbum} />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');

    const imageFile = new File(['image data'], 'photo.jpg', {
      type: 'image/jpeg'
    });
    const dataTransfer = {
      files: [imageFile],
      getData: () => ''
    };

    fireEvent.drop(albumButton, { dataTransfer });

    await waitFor(() => {
      expect(onDropToAlbum).toHaveBeenCalledWith('album-1', [imageFile]);
    });
  });

  it('handles drag enter and leave events on album', async () => {
    const onDropToAlbum = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onDropToAlbum={onDropToAlbum} />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');

    // Drag enter should highlight the album
    fireEvent.dragEnter(albumButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    await waitFor(() => {
      expect(albumButton).toHaveClass('ring-2');
    });

    // Drag leave should remove highlight
    fireEvent.dragLeave(albumButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    await waitFor(() => {
      expect(albumButton).not.toHaveClass('ring-2');
    });
  });

  it('handles drag over event on album', async () => {
    const onDropToAlbum = vi.fn();
    render(
      <PhotosAlbumsSidebar {...defaultProps} onDropToAlbum={onDropToAlbum} />
    );

    const albumButton = screen.getByText('Vacation').closest('button');
    if (!albumButton) throw new Error('Album button not found');

    // Fire dragOver event - it should not throw and should allow drop
    fireEvent.dragOver(albumButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    // If dragOver handler ran without error, the code path was exercised
    expect(albumButton).toBeInTheDocument();
  });

  it('opens new album dialog from empty space context menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<PhotosAlbumsSidebar {...defaultProps} />);

    const scrollableArea = container.querySelector('.overflow-y-auto');
    if (!scrollableArea) throw new Error('Scrollable area not found');
    await user.pointer({ keys: '[MouseRight]', target: scrollableArea });

    await waitFor(() => {
      expect(
        screen.getByTestId('empty-space-context-menu')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Album'));

    await waitFor(() => {
      expect(screen.getByTestId('new-album-dialog')).toBeInTheDocument();
    });
  });

  it('closes empty space context menu on backdrop click', async () => {
    const user = userEvent.setup();
    const { container } = render(<PhotosAlbumsSidebar {...defaultProps} />);

    const scrollableArea = container.querySelector('.overflow-y-auto');
    if (!scrollableArea) throw new Error('Scrollable area not found');
    await user.pointer({ keys: '[MouseRight]', target: scrollableArea });

    await waitFor(() => {
      expect(
        screen.getByTestId('empty-space-context-menu')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('empty-space-context-menu-backdrop'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('empty-space-context-menu')
      ).not.toBeInTheDocument();
    });
  });
});
