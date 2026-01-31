import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../../test/testUtils';
import { DeletePlaylistDialog } from './DeletePlaylistDialog';

const mockPlaylist = {
  id: 'playlist-1',
  name: 'Evening Mix',
  trackCount: 2,
  coverImageId: null
};

describe('DeletePlaylistDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    playlist: mockPlaylist,
    onDelete: vi.fn().mockResolvedValue(undefined),
    onPlaylistDeleted: vi.fn()
  };

  function renderDialog(overrides = {}) {
    const Wrapper = createWrapper();
    return render(
      <Wrapper>
        <DeletePlaylistDialog {...defaultProps} {...overrides} />
      </Wrapper>
    );
  }

  it('renders when open', () => {
    renderDialog();
    expect(screen.getByText('Delete Playlist')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Delete Playlist')).not.toBeInTheDocument();
  });

  it('deletes playlist and calls callbacks', async () => {
    const onOpenChange = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onPlaylistDeleted = vi.fn();

    renderDialog({ onOpenChange, onDelete, onPlaylistDeleted });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('delete-playlist-dialog-delete'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('playlist-1');
      expect(onPlaylistDeleted).toHaveBeenCalledWith('playlist-1');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
