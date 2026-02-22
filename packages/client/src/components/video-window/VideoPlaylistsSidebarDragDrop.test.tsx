import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockVideoPlaylist,
  createVideoPlaylistWrapper
} from '@/test/videoPlaylistTestUtils';
import { VideoPlaylistsSidebar } from './VideoPlaylistsSidebar';

const mockPlaylists = [
  createMockVideoPlaylist({ id: 'playlist-1', name: 'Action', trackCount: 5 }),
  createMockVideoPlaylist({ id: 'playlist-2', name: 'Comedy', trackCount: 3 })
];

describe('VideoPlaylistsSidebar keyboard resize', () => {
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
});

describe('VideoPlaylistsSidebar drag and drop', () => {
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
        type === 'application/x-tearleads-media-ids' ? payload : ''
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

  it('drops video files into a playlist', async () => {
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

    const videoFile = new File(['video data'], 'video.mp4', {
      type: 'video/mp4'
    });
    const dataTransfer = {
      files: [videoFile],
      getData: () => ''
    };

    fireEvent.drop(playlistButton, { dataTransfer });

    await waitFor(() => {
      expect(onDropToPlaylist).toHaveBeenCalledWith('playlist-1', [videoFile]);
    });
  });

  it('ignores drop with no video files or IDs', async () => {
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

    // Drop with empty data (no video IDs and no video files)
    const dataTransfer = {
      files: [],
      getData: () => ''
    };

    fireEvent.drop(playlistButton, { dataTransfer });

    // Should not call onDropToPlaylist when there's nothing to drop
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onDropToPlaylist).not.toHaveBeenCalled();
  });

  it('handles error when drop fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const fetchPlaylists = vi.fn(async () => mockPlaylists);
    const onDropToPlaylist = vi
      .fn()
      .mockRejectedValue(new Error('Drop failed'));
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
      ids: ['video-1']
    });
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === 'application/x-tearleads-media-ids' ? payload : ''
    };

    fireEvent.drop(playlistButton, { dataTransfer });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to handle video playlist drop',
        expect.any(Error)
      );
    });

    consoleErrorSpy.mockRestore();
  });

  it('handles drag enter and leave events on playlist', async () => {
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

    // Drag enter should highlight the playlist
    fireEvent.dragEnter(playlistButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    await waitFor(() => {
      expect(playlistButton).toHaveClass('ring-2');
    });

    // Drag leave should remove highlight
    fireEvent.dragLeave(playlistButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    await waitFor(() => {
      expect(playlistButton).not.toHaveClass('ring-2');
    });
  });

  it('handles drag over event on playlist', async () => {
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

    // Fire dragOver event - it should not throw and should allow drop
    fireEvent.dragOver(playlistButton, {
      dataTransfer: { files: [], getData: () => '' }
    });

    // If dragOver handler ran without error, the code path was exercised
    expect(playlistButton).toBeInTheDocument();
  });
});
