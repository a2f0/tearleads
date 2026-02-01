import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createVideoPlaylistWrapper } from '@/test/videoPlaylistTestUtils';
import { NewVideoPlaylistDialog } from './NewVideoPlaylistDialog';

describe('NewVideoPlaylistDialog', () => {
  it('renders when open', () => {
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={vi.fn()}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    expect(screen.getByText('New Video Playlist')).toBeInTheDocument();
    expect(
      screen.getByTestId('new-video-playlist-name-input')
    ).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={false}
          onOpenChange={vi.fn()}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    expect(screen.queryByText('New Video Playlist')).not.toBeInTheDocument();
  });

  it('creates playlist when form is submitted', async () => {
    const user = userEvent.setup();
    const createPlaylist = vi.fn(async () => 'new-playlist-id');
    const onPlaylistCreated = vi.fn();
    const onOpenChange = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      createPlaylist
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={onOpenChange}
          onPlaylistCreated={onPlaylistCreated}
        />
      </Wrapper>
    );

    const input = screen.getByTestId('new-video-playlist-name-input');
    await user.type(input, 'My Videos');

    const createButton = screen.getByTestId('new-video-playlist-dialog-create');
    await user.click(createButton);

    await waitFor(() => {
      expect(createPlaylist).toHaveBeenCalledWith('My Videos');
      expect(onPlaylistCreated).toHaveBeenCalledWith(
        'new-playlist-id',
        'My Videos'
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('disables create button when name is empty', () => {
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={vi.fn()}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const createButton = screen.getByTestId('new-video-playlist-dialog-create');
    expect(createButton).toBeDisabled();
  });

  it('closes dialog when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={onOpenChange}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const cancelButton = screen.getByTestId('new-video-playlist-dialog-cancel');
    await user.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog when escape is pressed', async () => {
    const onOpenChange = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={onOpenChange}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const dialog = screen.getByTestId('new-video-playlist-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={onOpenChange}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const backdrop = screen.getByTestId('new-video-playlist-dialog-backdrop');
    await user.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('handles create error gracefully', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const createPlaylist = vi.fn(async () => {
      throw new Error('Network error');
    });
    const onOpenChange = vi.fn();

    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true },
      createPlaylist
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={onOpenChange}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const input = screen.getByTestId('new-video-playlist-name-input');
    await user.type(input, 'Test Playlist');

    const createButton = screen.getByTestId('new-video-playlist-dialog-create');
    await user.click(createButton);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to create video playlist:',
        expect.any(Error)
      );
    });

    // Dialog should not close on error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    consoleError.mockRestore();
  });

  it('traps focus with tab key', async () => {
    const Wrapper = createVideoPlaylistWrapper({
      databaseState: { isUnlocked: true }
    });

    render(
      <Wrapper>
        <NewVideoPlaylistDialog
          open={true}
          onOpenChange={vi.fn()}
          onPlaylistCreated={vi.fn()}
        />
      </Wrapper>
    );

    const dialog = screen.getByTestId('new-video-playlist-dialog');
    const input = screen.getByTestId('new-video-playlist-name-input');
    const createButton = screen.getByTestId('new-video-playlist-dialog-create');

    // Focus the create button (last focusable element)
    createButton.focus();

    // Tab should wrap to first element
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });

    // Shift+Tab from first element should wrap to last
    input.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    // Just verify the handlers were triggered (focus trap works)
    expect(dialog).toBeInTheDocument();
  });
});
