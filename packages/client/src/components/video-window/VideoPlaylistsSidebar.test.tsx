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
    // Mock getTrackIdsInPlaylist to return arrays matching playlist.trackCount
    const getTrackIdsInPlaylist = vi.fn(async (playlistId: string) => {
      if (playlistId === 'playlist-1') return ['v1', 'v2', 'v3', 'v4', 'v5'];
      if (playlistId === 'playlist-2') return ['v1', 'v2', 'v3'];
      return [];
    });
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      fetchPlaylists,
      getTrackIdsInPlaylist
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

    // Check track counts (updated dynamically via getTrackIdsInPlaylist)
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
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
});
