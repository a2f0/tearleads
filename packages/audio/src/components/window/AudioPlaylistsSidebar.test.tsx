import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_AUDIO_ID, AudioPlaylistsSidebar } from './AudioPlaylistsSidebar';

const mockPlaylists = [
  { id: 'playlist-1', name: 'Road Trip', trackCount: 12, coverImageId: null },
  { id: 'playlist-2', name: 'Focus', trackCount: 4, coverImageId: null }
];

const mockUseAudioPlaylists: {
  playlists: typeof mockPlaylists;
  loading: boolean;
  error: string | null;
  refetch: ReturnType<typeof vi.fn>;
  deletePlaylist: ReturnType<typeof vi.fn>;
  renamePlaylist: ReturnType<typeof vi.fn>;
} = {
  playlists: mockPlaylists,
  loading: false,
  error: null,
  refetch: vi.fn(),
  deletePlaylist: vi.fn().mockResolvedValue(undefined),
  renamePlaylist: vi.fn().mockResolvedValue(undefined)
};

vi.mock('./useAudioPlaylists', () => ({
  useAudioPlaylists: () => mockUseAudioPlaylists
}));

vi.mock('./NewPlaylistDialog', () => ({
  NewPlaylistDialog: ({
    open,
    onOpenChange
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="new-playlist-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null
}));

vi.mock('./RenamePlaylistDialog', () => ({
  RenamePlaylistDialog: ({
    open,
    onOpenChange,
    onPlaylistRenamed
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPlaylistRenamed?: () => void;
  }) =>
    open ? (
      <div data-testid="rename-playlist-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            onPlaylistRenamed?.();
            onOpenChange(false);
          }}
        >
          Save
        </button>
      </div>
    ) : null
}));

vi.mock('./DeletePlaylistDialog', () => ({
  DeletePlaylistDialog: ({
    open,
    onOpenChange,
    onPlaylistDeleted,
    playlist
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPlaylistDeleted?: (playlistId: string) => void;
    playlist: { id: string } | null;
  }) =>
    open ? (
      <div data-testid="delete-playlist-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (playlist) onPlaylistDeleted?.(playlist.id);
            onOpenChange(false);
          }}
        >
          Delete
        </button>
      </div>
    ) : null
}));

describe('AudioPlaylistsSidebar', () => {
  const defaultProps = {
    width: 200,
    onWidthChange: vi.fn(),
    selectedPlaylistId: ALL_AUDIO_ID,
    onPlaylistSelect: vi.fn(),
    onPlaylistChanged: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAudioPlaylists.playlists = mockPlaylists;
    mockUseAudioPlaylists.loading = false;
    mockUseAudioPlaylists.error = null;
  });

  it('renders All Tracks option', () => {
    render(<AudioPlaylistsSidebar {...defaultProps} />);
    expect(screen.getByText('All Tracks')).toBeInTheDocument();
  });

  it('renders playlist list', () => {
    render(<AudioPlaylistsSidebar {...defaultProps} />);
    expect(screen.getByText('Road Trip')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
  });

  it('shows track counts', () => {
    render(<AudioPlaylistsSidebar {...defaultProps} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('selects All Tracks when clicked', async () => {
    const user = userEvent.setup();
    const onPlaylistSelect = vi.fn();

    render(
      <AudioPlaylistsSidebar
        {...defaultProps}
        onPlaylistSelect={onPlaylistSelect}
      />
    );

    await user.click(screen.getByText('All Tracks'));
    expect(onPlaylistSelect).toHaveBeenCalledWith(ALL_AUDIO_ID);
  });

  it('selects playlist when clicked', async () => {
    const user = userEvent.setup();
    const onPlaylistSelect = vi.fn();

    render(
      <AudioPlaylistsSidebar
        {...defaultProps}
        onPlaylistSelect={onPlaylistSelect}
      />
    );

    await user.click(screen.getByText('Road Trip'));
    expect(onPlaylistSelect).toHaveBeenCalledWith('playlist-1');
  });

  it('highlights selected playlist', () => {
    render(
      <AudioPlaylistsSidebar {...defaultProps} selectedPlaylistId="playlist-1" />
    );

    const playlistButton = screen.getByText('Road Trip').closest('button');
    expect(playlistButton).toHaveClass('bg-accent');
  });

  it('highlights All Tracks when selected', () => {
    render(
      <AudioPlaylistsSidebar {...defaultProps} selectedPlaylistId={ALL_AUDIO_ID} />
    );

    const allTracksButton = screen.getByText('All Tracks').closest('button');
    expect(allTracksButton).toHaveClass('bg-accent');
  });

  it('opens new playlist dialog on button click', async () => {
    const user = userEvent.setup();
    render(<AudioPlaylistsSidebar {...defaultProps} />);

    await user.click(screen.getByTitle('New Playlist'));
    expect(screen.getByTestId('new-playlist-dialog')).toBeInTheDocument();
  });

  it('opens context menu on right click', async () => {
    const user = userEvent.setup();
    render(<AudioPlaylistsSidebar {...defaultProps} />);

    const playlistButton = screen.getByText('Road Trip').closest('button');
    if (!playlistButton) throw new Error('Playlist button not found');
    await user.pointer({ keys: '[MouseRight]', target: playlistButton });

    await waitFor(() => {
      expect(screen.getByTestId('playlist-context-menu')).toBeInTheDocument();
    });
  });

  it('shows loading state', () => {
    mockUseAudioPlaylists.loading = true;
    mockUseAudioPlaylists.playlists = [];

    render(<AudioPlaylistsSidebar {...defaultProps} />);

    expect(screen.getByText('All Tracks')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseAudioPlaylists.error = 'Failed to load';

    render(<AudioPlaylistsSidebar {...defaultProps} />);

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('exports ALL_AUDIO_ID constant', () => {
    expect(ALL_AUDIO_ID).toBe('__all__');
  });
});
