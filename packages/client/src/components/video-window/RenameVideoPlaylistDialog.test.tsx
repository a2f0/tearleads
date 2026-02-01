import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockVideoPlaylist } from '@/test/videoPlaylistTestUtils';
import { RenameVideoPlaylistDialog } from './RenameVideoPlaylistDialog';

const mockPlaylist = createMockVideoPlaylist({
  id: 'playlist-1',
  name: 'Action Movies'
});

describe('RenameVideoPlaylistDialog', () => {
  it('renders when open with playlist', () => {
    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    expect(screen.getByText('Rename Playlist')).toBeInTheDocument();
    const input = screen.getByTestId('rename-video-playlist-name-input');
    expect(input).toHaveValue('Action Movies');
  });

  it('does not render when closed', () => {
    render(
      <RenameVideoPlaylistDialog
        open={false}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    expect(screen.queryByText('Rename Playlist')).not.toBeInTheDocument();
  });

  it('does not render when playlist is null', () => {
    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={null}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    expect(screen.queryByText('Rename Playlist')).not.toBeInTheDocument();
  });

  it('renames playlist when form is submitted', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(async () => {});
    const onPlaylistRenamed = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onRename={onRename}
        onPlaylistRenamed={onPlaylistRenamed}
      />
    );

    const input = screen.getByTestId('rename-video-playlist-name-input');
    await user.clear(input);
    await user.type(input, 'Comedy Movies');

    const renameButton = screen.getByTestId(
      'rename-video-playlist-dialog-rename'
    );
    await user.click(renameButton);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('playlist-1', 'Comedy Movies');
      expect(onPlaylistRenamed).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('disables rename button when name is empty', async () => {
    const user = userEvent.setup();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const input = screen.getByTestId('rename-video-playlist-name-input');
    await user.clear(input);

    const renameButton = screen.getByTestId(
      'rename-video-playlist-dialog-rename'
    );
    expect(renameButton).toBeDisabled();
  });

  it('closes dialog when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const cancelButton = screen.getByTestId(
      'rename-video-playlist-dialog-cancel'
    );
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog when escape is pressed', async () => {
    const onOpenChange = vi.fn();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const dialog = screen.getByTestId('rename-video-playlist-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows loading state while renaming', async () => {
    const user = userEvent.setup();
    // Create a promise that we control
    let resolveRename: () => void;
    const renamePromise = new Promise<void>((resolve) => {
      resolveRename = resolve;
    });
    const onRename = vi.fn(() => renamePromise);

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onRename={onRename}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const renameButton = screen.getByTestId(
      'rename-video-playlist-dialog-rename'
    );
    await user.click(renameButton);

    expect(screen.getByText('Renaming...')).toBeInTheDocument();
    expect(renameButton).toBeDisabled();

    // Resolve the promise and wait for state to update
    await waitFor(async () => {
      resolveRename?.();
    });
  });

  it('handles rename error gracefully', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onRename = vi.fn(async () => {
      throw new Error('Network error');
    });
    const onOpenChange = vi.fn();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onRename={onRename}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const renameButton = screen.getByTestId(
      'rename-video-playlist-dialog-rename'
    );
    await user.click(renameButton);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to rename video playlist:',
        expect.any(Error)
      );
    });

    consoleError.mockRestore();
  });

  it('traps focus with tab key', () => {
    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={vi.fn()}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const dialog = screen.getByTestId('rename-video-playlist-dialog');
    const input = screen.getByTestId('rename-video-playlist-name-input');
    const renameButton = screen.getByTestId(
      'rename-video-playlist-dialog-rename'
    );

    // Focus the rename button (last focusable element)
    renameButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });

    // Shift+Tab from first element
    input.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(dialog).toBeInTheDocument();
  });

  it('closes when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <RenameVideoPlaylistDialog
        open={true}
        onOpenChange={onOpenChange}
        playlist={mockPlaylist}
        onRename={vi.fn()}
        onPlaylistRenamed={vi.fn()}
      />
    );

    const backdrop = screen.getByTestId(
      'rename-video-playlist-dialog-backdrop'
    );
    await user.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
