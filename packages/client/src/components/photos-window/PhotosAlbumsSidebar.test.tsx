import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_PHOTOS_ID, PhotosAlbumsSidebar } from './PhotosAlbumsSidebar';

const mockAlbums = [
  { id: 'album-1', name: 'Vacation', photoCount: 10, coverPhotoId: null },
  { id: 'album-2', name: 'Family', photoCount: 5, coverPhotoId: null }
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
  RenameAlbumDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="rename-album-dialog" /> : null
}));

vi.mock('./DeleteAlbumDialog', () => ({
  DeleteAlbumDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="delete-album-dialog" /> : null
}));

describe('PhotosAlbumsSidebar', () => {
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
});
