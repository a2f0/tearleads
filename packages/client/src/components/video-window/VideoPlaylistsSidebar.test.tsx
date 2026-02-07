import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockVideoPlaylist,
  createVideoPlaylistWrapper
} from '@/test/videoPlaylistTestUtils';
import { ALL_VIDEO_ID, VideoPlaylistsSidebar } from './VideoPlaylistsSidebar';

const mockPlaylists = [
  createMockVideoPlaylist({ id: 'playlist-1', name: 'Action', trackCount: 5 }),
  createMockVideoPlaylist({ id: 'playlist-2', name: 'Comedy', trackCount: 3 })
];

describe('VideoPlaylistsSidebar', () => {
  it('renders All Videos button', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={ALL_VIDEO_ID}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    expect(screen.getByText('All Videos')).toBeInTheDocument();
  });

  it('renders playlists from context', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
      expect(screen.getByText('Comedy')).toBeInTheDocument();
    });

    // Check track counts
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('refetches when refresh token changes', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    const { rerender } = render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
          refreshToken={0}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const initialFetchCount = fetchPlaylists.mock.calls.length;
    expect(initialFetchCount).toBeGreaterThan(0);

    rerender(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
          refreshToken={1}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(fetchPlaylists).toHaveBeenCalledTimes(initialFetchCount + 1);
    });
  });

  it('shows loading indicator while fetching', async () => {
    // Create a promise that never resolves to keep loading state
    const fetchPlaylists = vi.fn(
      () => new Promise<typeof mockPlaylists>(() => {})
    );
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    // The loading indicator should be visible
    await waitFor(() => {
      const loader = document.querySelector('.animate-spin');
      expect(loader).toBeInTheDocument();
    });
  });

  it('calls onPlaylistSelect when clicking All Videos', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const onPlaylistSelect = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId="playlist-1"
          onPlaylistSelect={onPlaylistSelect}
        />
      </Wrapper>
    );

    fireEvent.click(screen.getByText('All Videos'));
    expect(onPlaylistSelect).toHaveBeenCalledWith(ALL_VIDEO_ID);
  });

  it('calls onPlaylistSelect when clicking a playlist', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const onPlaylistSelect = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={ALL_VIDEO_ID}
          onPlaylistSelect={onPlaylistSelect}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Action'));
    expect(onPlaylistSelect).toHaveBeenCalledWith('playlist-1');
  });

  it('highlights selected playlist', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId="playlist-1"
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const actionButton = screen.getByText('Action').closest('button');
    expect(actionButton).toHaveClass('bg-accent');
  });

  it('opens new playlist dialog when clicking plus button', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    const newButton = screen.getByTitle('New Playlist');
    fireEvent.click(newButton);

    await waitFor(() => {
      expect(screen.getByText('New Video Playlist')).toBeInTheDocument();
    });
  });

  it('opens context menu on right-click', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('displays error message when fetch fails', async () => {
    const fetchPlaylists = vi.fn(async () => {
      throw new Error('Failed to load');
    });
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  it('calls onWidthChange when resizing', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const onWidthChange = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={onWidthChange}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    const resizeHandle = screen.getByLabelText('Resize playlist sidebar');

    // Simulate mouse down and move
    fireEvent.mouseDown(resizeHandle, { clientX: 200 });

    // Simulate mouse move on document
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('opens rename dialog from context menu', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Rename'));

    await waitFor(() => {
      expect(screen.getByText('Rename Playlist')).toBeInTheDocument();
    });
  });

  it('opens delete dialog from context menu', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete Playlist')).toBeInTheDocument();
    });
  });

  it('closes rename dialog via onOpenChange', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    // Open context menu
    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    // Click rename to open dialog
    fireEvent.click(screen.getByText('Rename'));

    await waitFor(() => {
      expect(screen.getByText('Rename Playlist')).toBeInTheDocument();
    });

    // Close via escape key
    const dialog = screen.getByTestId('rename-video-playlist-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Rename Playlist')).not.toBeInTheDocument();
    });
  });

  it('calls onPlaylistSelect with ALL_VIDEO_ID when deleting selected playlist', async () => {
    const deletePlaylist = vi.fn(async () => {});
    const onPlaylistSelect = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists: vi.fn(async () => mockPlaylists),
      deletePlaylist
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId="playlist-1"
          onPlaylistSelect={onPlaylistSelect}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    // Right-click on Action playlist (which is playlist-1)
    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete Playlist')).toBeInTheDocument();
    });

    // Click delete button in dialog
    const deleteButton = screen.getByTestId(
      'delete-video-playlist-dialog-delete'
    );
    fireEvent.click(deleteButton);

    // Should switch to All Videos since we deleted the selected playlist
    await waitFor(() => {
      expect(deletePlaylist).toHaveBeenCalledWith('playlist-1');
      expect(onPlaylistSelect).toHaveBeenCalledWith(ALL_VIDEO_ID);
    });
  });

  it('closes delete dialog via onOpenChange', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    // Open context menu
    const actionButton = screen.getByText('Action').closest('button');
    if (actionButton) fireEvent.contextMenu(actionButton);

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    // Click delete to open dialog
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete Playlist')).toBeInTheDocument();
    });

    // Close via escape key
    const dialog = screen.getByTestId('delete-video-playlist-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Delete Playlist')).not.toBeInTheDocument();
    });
  });

  it('opens empty space context menu and shows New Playlist option', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    // Find the sidebar container and right-click on it
    const sidebar = screen.getByTestId('video-playlists-sidebar');
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (scrollableArea) fireEvent.contextMenu(scrollableArea);

    await waitFor(() => {
      expect(screen.getByText('New Playlist')).toBeInTheDocument();
    });
  });

  it('opens new playlist dialog from empty space context menu', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    // Find the sidebar container and right-click on it
    const sidebar = screen.getByTestId('video-playlists-sidebar');
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (scrollableArea) fireEvent.contextMenu(scrollableArea);

    await waitFor(() => {
      expect(screen.getByText('New Playlist')).toBeInTheDocument();
    });

    // Click "New Playlist" in context menu
    fireEvent.click(screen.getByText('New Playlist'));

    await waitFor(() => {
      expect(screen.getByText('New Video Playlist')).toBeInTheDocument();
    });
  });

  it('closes empty space context menu via backdrop click', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    // Open empty space context menu
    const sidebar = screen.getByTestId('video-playlists-sidebar');
    const scrollableArea = sidebar.querySelector('.overflow-y-auto');
    if (scrollableArea) fireEvent.contextMenu(scrollableArea);

    await waitFor(() => {
      expect(
        screen.getByTestId('video-empty-space-context-menu')
      ).toBeInTheDocument();
    });

    // Close by clicking backdrop
    fireEvent.click(
      screen.getByTestId('video-empty-space-context-menu-backdrop')
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId('video-empty-space-context-menu')
      ).not.toBeInTheDocument();
    });
  });

  it('handles keyboard resize with ArrowRight key', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const onWidthChange = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={onWidthChange}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    const resizeHandle = screen.getByLabelText('Resize playlist sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(onWidthChange).toHaveBeenCalledWith(210);
  });

  it('handles keyboard resize with ArrowLeft key', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const onWidthChange = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={onWidthChange}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    const resizeHandle = screen.getByLabelText('Resize playlist sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

    expect(onWidthChange).toHaveBeenCalledWith(190);
  });

  it('ignores non-arrow keys for keyboard resize', async () => {
    const fetchPlaylists = vi.fn(async () => []);
    const onWidthChange = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={onWidthChange}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
        />
      </Wrapper>
    );

    const resizeHandle = screen.getByLabelText('Resize playlist sidebar');
    fireEvent.keyDown(resizeHandle, { key: 'Enter' });

    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it('drops dragged videos into a playlist', async () => {
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const onDropToPlaylist = vi.fn();
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists
    });

    render(
      <Wrapper>
        <VideoPlaylistsSidebar
          width={200}
          onWidthChange={vi.fn()}
          selectedPlaylistId={null}
          onPlaylistSelect={vi.fn()}
          onDropToPlaylist={onDropToPlaylist}
        />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Action')).toBeInTheDocument();
    });

    const playlistButton = screen.getByText('Action').closest('button');
    if (!playlistButton) throw new Error('Playlist button not found');

    const payload = JSON.stringify({
      mediaType: 'video',
      ids: ['video-1', 'video-2']
    });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-rapid-media-ids' ? payload : ''
    };

    fireEvent.drop(playlistButton, { dataTransfer });

    await waitFor(() => {
      expect(onDropToPlaylist).toHaveBeenCalledWith(
        'playlist-1',
        [],
        ['video-1', 'video-2']
      );
    });
  });
});
