import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameAlbumDialog } from './RenameAlbumDialog';

describe('RenameAlbumDialog', () => {
  const mockAlbum = {
    id: 'album-123',
    name: 'Original Name',
    photoCount: 5,
    coverPhotoId: null
  };

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    album: mockAlbum,
    onRename: vi.fn().mockResolvedValue(undefined),
    onAlbumRenamed: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open with album', () => {
    render(<RenameAlbumDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Rename Album')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<RenameAlbumDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when album is null', () => {
    render(<RenameAlbumDialog {...defaultProps} album={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pre-fills input with album name', () => {
    render(<RenameAlbumDialog {...defaultProps} />);
    expect(screen.getByTestId('rename-album-name-input')).toHaveValue(
      'Original Name'
    );
  });

  it('renames album on submit', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onAlbumRenamed = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameAlbumDialog
        {...defaultProps}
        onRename={onRename}
        onAlbumRenamed={onAlbumRenamed}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByTestId('rename-album-name-input');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByTestId('rename-album-dialog-save'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('album-123', 'New Name');
      expect(onAlbumRenamed).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes without renaming if name unchanged', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RenameAlbumDialog
        {...defaultProps}
        onRename={onRename}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByTestId('rename-album-dialog-save'));

    expect(onRename).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<RenameAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('rename-album-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on escape key', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<RenameAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<RenameAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('rename-album-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables save button when name is empty', async () => {
    const user = userEvent.setup();
    render(<RenameAlbumDialog {...defaultProps} />);

    const input = screen.getByTestId('rename-album-name-input');
    await user.clear(input);

    expect(screen.getByTestId('rename-album-dialog-save')).toBeDisabled();
  });

  it('handles rename error gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRename = vi.fn().mockRejectedValue(new Error('Rename failed'));

    render(<RenameAlbumDialog {...defaultProps} onRename={onRename} />);

    const input = screen.getByTestId('rename-album-name-input');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByTestId('rename-album-dialog-save'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it('submits on enter key', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameAlbumDialog {...defaultProps} onRename={onRename} />);

    const input = screen.getByTestId('rename-album-name-input');
    await user.clear(input);
    await user.type(input, 'New Name');
    const form = input.closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('album-123', 'New Name');
    });
  });
});
