import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockVideoPlaylist } from '@/test/videoPlaylistTestUtils';
import { VideoPlaylistsContextMenu } from './VideoPlaylistsContextMenu';

const mockPlaylist = createMockVideoPlaylist({
  id: 'playlist-1',
  name: 'Action Movies'
});

describe('VideoPlaylistsContextMenu', () => {
  it('renders at the specified position', () => {
    render(
      <VideoPlaylistsContextMenu
        x={100}
        y={200}
        playlist={mockPlaylist}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menu = screen.getByTestId('video-playlist-context-menu');
    expect(menu).toHaveStyle({ left: '100px', top: '200px' });
  });

  it('renders rename and delete buttons', () => {
    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls onRename and onClose when rename is clicked', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();

    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={onClose}
        onRename={onRename}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('video-playlist-context-menu-rename'));

    expect(onRename).toHaveBeenCalledWith(mockPlaylist);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete and onClose when delete is clicked', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();

    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={onClose}
        onRename={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTestId('video-playlist-context-menu-delete'));

    expect(onDelete).toHaveBeenCalledWith(mockPlaylist);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on escape key', () => {
    const onClose = vi.fn();

    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={onClose}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking the backdrop', () => {
    const onClose = vi.fn();

    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={onClose}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId('video-playlist-context-menu-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the menu', () => {
    const onClose = vi.fn();

    render(
      <VideoPlaylistsContextMenu
        x={0}
        y={0}
        playlist={mockPlaylist}
        onClose={onClose}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const menu = screen.getByTestId('video-playlist-context-menu');
    fireEvent.click(menu);

    expect(onClose).not.toHaveBeenCalled();
  });
});
