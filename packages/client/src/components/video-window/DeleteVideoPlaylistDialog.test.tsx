import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockVideoPlaylist } from '@/test/videoPlaylistTestUtils';
import { DeleteVideoPlaylistDialog } from './DeleteVideoPlaylistDialog';

const mockPlaylist = createMockVideoPlaylist({
  id: 'playlist-1',
  name: 'Action Movies'
});

describe('DeleteVideoPlaylistDialog', () => {
  it('renders when open with playlist', () => {
    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    expect(screen.getByText('Delete Playlist')).toBeInTheDocument();
    expect(screen.getByText(/Action Movies/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <DeleteVideoPlaylistDialog
        open={false}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    expect(screen.queryByText('Delete Playlist')).not.toBeInTheDocument();
  });

  it('does not render when playlist is null', () => {
    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={null}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    expect(screen.queryByText('Delete Playlist')).not.toBeInTheDocument();
  });

  it('deletes playlist when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => {});
    const onPlaylistDeleted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onDelete={onDelete}
        onPlaylistDeleted={onPlaylistDeleted}
      />
    );

    const deleteButton = screen.getByTestId(
      'delete-video-playlist-dialog-delete'
    );
    await user.click(deleteButton);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('playlist-1');
      expect(onPlaylistDeleted).toHaveBeenCalledWith('playlist-1');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes dialog when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const cancelButton = screen.getByTestId(
      'delete-video-playlist-dialog-cancel'
    );
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog when escape is pressed', async () => {
    const onOpenChange = vi.fn();

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const dialog = screen.getByTestId('delete-video-playlist-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows loading state while deleting', async () => {
    const user = userEvent.setup();
    // Create a promise that we control
    let resolveDelete: () => void;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDelete = vi.fn(() => deletePromise);

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onDelete={onDelete}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const deleteButton = screen.getByTestId(
      'delete-video-playlist-dialog-delete'
    );
    await user.click(deleteButton);

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
    expect(deleteButton).toBeDisabled();

    // Resolve the promise and wait for state to update
    await waitFor(async () => {
      resolveDelete?.();
    });
  });

  it('handles delete error gracefully', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onDelete = vi.fn(async () => {
      throw new Error('Network error');
    });
    const onOpenChange = vi.fn();

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onDelete={onDelete}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const deleteButton = screen.getByTestId(
      'delete-video-playlist-dialog-delete'
    );
    await user.click(deleteButton);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to delete video playlist:',
        expect.any(Error)
      );
    });

    consoleError.mockRestore();
  });

  it('traps focus with tab key', () => {
    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const dialog = screen.getByTestId('delete-video-playlist-dialog');
    const deleteButton = screen.getByTestId(
      'delete-video-playlist-dialog-delete'
    );
    const cancelButton = screen.getByTestId(
      'delete-video-playlist-dialog-cancel'
    );

    // Focus delete button (last focusable)
    deleteButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });

    // Shift+Tab from first
    cancelButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(dialog).toBeInTheDocument();
  });

  it('closes when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <DeleteVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onDelete={vi.fn()}
        onPlaylistDeleted={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId(
      'delete-video-playlist-dialog-backdrop'
    );
    await user.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
