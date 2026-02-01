import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../../test/testUtils';
import { RenamePlaylistDialog } from './RenamePlaylistDialog';

const mockPlaylist = {
  id: 'playlist-1',
  name: 'Old Name',
  trackCount: 3,
  coverImageId: null,
  mediaType: 'audio' as const
};

describe('RenamePlaylistDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    playlist: mockPlaylist,
    onRename: vi.fn().mockResolvedValue(undefined),
    onPlaylistRenamed: vi.fn()
  };

  function renderDialog(overrides = {}) {
    const Wrapper = createWrapper();
    return render(
      <Wrapper>
        <RenamePlaylistDialog {...defaultProps} {...overrides} />
      </Wrapper>
    );
  }

  it('renders when open', () => {
    renderDialog();
    expect(screen.getByText('Rename Playlist')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Rename Playlist')).not.toBeInTheDocument();
  });

  it('renames playlist and calls callbacks', async () => {
    const onOpenChange = vi.fn();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onPlaylistRenamed = vi.fn();

    renderDialog({ onOpenChange, onRename, onPlaylistRenamed });

    const user = userEvent.setup();
    const input = screen.getByTestId('rename-playlist-name-input');
    await user.clear(input);
    await user.type(input, 'New Name');

    await user.click(screen.getByTestId('rename-playlist-dialog-save'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('playlist-1', 'New Name');
      expect(onPlaylistRenamed).toHaveBeenCalledWith('playlist-1', 'New Name');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
