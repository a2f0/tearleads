import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteAlbumDialog } from './DeleteAlbumDialog';

describe('DeleteAlbumDialog', () => {
  const mockAlbum = {
    id: 'album-123',
    name: 'Test Album',
    photoCount: 5,
    coverPhotoId: null,
    albumType: 'custom' as const
  };

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    album: mockAlbum,
    onDelete: vi.fn().mockResolvedValue(undefined),
    onAlbumDeleted: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open with album', () => {
    render(<DeleteAlbumDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Album')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<DeleteAlbumDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when album is null', () => {
    render(<DeleteAlbumDialog {...defaultProps} album={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows album name in confirmation message', () => {
    render(<DeleteAlbumDialog {...defaultProps} />);
    expect(screen.getByText(/Test Album/)).toBeInTheDocument();
  });

  it('deletes album on confirm', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onAlbumDeleted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <DeleteAlbumDialog
        {...defaultProps}
        onDelete={onDelete}
        onAlbumDeleted={onAlbumDeleted}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByTestId('delete-album-dialog-delete'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('album-123');
      expect(onAlbumDeleted).toHaveBeenCalledWith('album-123');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes on cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DeleteAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('delete-album-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on escape key', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DeleteAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DeleteAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('delete-album-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('handles delete error gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));

    render(<DeleteAlbumDialog {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByTestId('delete-album-dialog-delete'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it('focuses cancel button on open', async () => {
    render(<DeleteAlbumDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('delete-album-dialog-cancel')).toHaveFocus();
    });
  });

  it('traps focus within dialog - tab from last element wraps to first', async () => {
    const user = userEvent.setup();
    render(<DeleteAlbumDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-album-dialog-cancel')).toHaveFocus();
    });

    // Tab to delete button
    await user.tab();
    expect(screen.getByTestId('delete-album-dialog-delete')).toHaveFocus();

    // Tab should wrap to cancel button
    await user.tab();
    expect(screen.getByTestId('delete-album-dialog-cancel')).toHaveFocus();
  });

  it('traps focus within dialog - shift+tab from first element wraps to last', async () => {
    const user = userEvent.setup();
    render(<DeleteAlbumDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-album-dialog-cancel')).toHaveFocus();
    });

    // Shift+Tab should wrap to delete button
    await user.tab({ shift: true });
    expect(screen.getByTestId('delete-album-dialog-delete')).toHaveFocus();
  });
});
