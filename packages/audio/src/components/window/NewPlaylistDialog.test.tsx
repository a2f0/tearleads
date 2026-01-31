import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../../test/testUtils';
import { NewPlaylistDialog } from './NewPlaylistDialog';

const mockCreatePlaylist = vi.fn();

vi.mock('./useAudioPlaylists', () => ({
  useAudioPlaylists: () => ({
    createPlaylist: mockCreatePlaylist
  })
}));

describe('NewPlaylistDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onPlaylistCreated: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog(overrides = {}) {
    const Wrapper = createWrapper();
    return render(
      <Wrapper>
        <NewPlaylistDialog {...defaultProps} {...overrides} />
      </Wrapper>
    );
  }

  it('renders when open', () => {
    renderDialog();
    expect(screen.getByText('New Playlist')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('New Playlist')).not.toBeInTheDocument();
  });

  it('creates playlist and calls callbacks', async () => {
    mockCreatePlaylist.mockResolvedValueOnce('playlist-123');
    const onOpenChange = vi.fn();
    const onPlaylistCreated = vi.fn();

    renderDialog({ onOpenChange, onPlaylistCreated });

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId('new-playlist-name-input'),
      'Morning Mix'
    );

    await user.click(screen.getByTestId('new-playlist-dialog-create'));

    await waitFor(() => {
      expect(mockCreatePlaylist).toHaveBeenCalledWith('Morning Mix');
      expect(onPlaylistCreated).toHaveBeenCalledWith(
        'playlist-123',
        'Morning Mix'
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
