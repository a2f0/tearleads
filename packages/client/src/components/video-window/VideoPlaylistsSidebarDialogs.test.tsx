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

describe('VideoPlaylistsSidebar dialogs', () => {
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
});
