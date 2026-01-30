import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewAlbumDialog } from './NewAlbumDialog';

const mockCreateAlbum = vi.fn();

vi.mock('./usePhotoAlbums', () => ({
  usePhotoAlbums: () => ({
    createAlbum: mockCreateAlbum
  })
}));

describe('NewAlbumDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onAlbumCreated: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAlbum.mockResolvedValue('new-album-id');
  });

  it('renders when open', () => {
    render(<NewAlbumDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('New Album')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<NewAlbumDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('focuses input on open', async () => {
    render(<NewAlbumDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('new-album-name-input')).toHaveFocus();
    });
  });

  it('creates album on submit', async () => {
    const user = userEvent.setup();
    const onAlbumCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <NewAlbumDialog
        {...defaultProps}
        onAlbumCreated={onAlbumCreated}
        onOpenChange={onOpenChange}
      />
    );

    await user.type(screen.getByTestId('new-album-name-input'), 'My Album');
    await user.click(screen.getByTestId('new-album-dialog-create'));

    await waitFor(() => {
      expect(mockCreateAlbum).toHaveBeenCalledWith('My Album');
      expect(onAlbumCreated).toHaveBeenCalledWith('new-album-id', 'My Album');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('closes on cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<NewAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('new-album-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on escape key', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<NewAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<NewAlbumDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('new-album-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables create button when name is empty', () => {
    render(<NewAlbumDialog {...defaultProps} />);
    expect(screen.getByTestId('new-album-dialog-create')).toBeDisabled();
  });

  it('enables create button when name is entered', async () => {
    const user = userEvent.setup();
    render(<NewAlbumDialog {...defaultProps} />);

    await user.type(screen.getByTestId('new-album-name-input'), 'Test');

    expect(screen.getByTestId('new-album-dialog-create')).not.toBeDisabled();
  });

  it('traps focus within dialog', async () => {
    const user = userEvent.setup();
    render(<NewAlbumDialog {...defaultProps} />);

    const input = screen.getByTestId('new-album-name-input');
    const cancelButton = screen.getByTestId('new-album-dialog-cancel');

    await waitFor(() => expect(input).toHaveFocus());

    // Type something to enable the create button
    await user.type(input, 'Test');

    const createButton = screen.getByTestId('new-album-dialog-create');

    await user.tab();
    expect(cancelButton).toHaveFocus();

    await user.tab();
    expect(createButton).toHaveFocus();

    await user.tab();
    expect(input).toHaveFocus();
  });

  it('handles create error gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateAlbum.mockRejectedValue(new Error('Create failed'));

    render(<NewAlbumDialog {...defaultProps} />);

    await user.type(screen.getByTestId('new-album-name-input'), 'Test Album');
    await user.click(screen.getByTestId('new-album-dialog-create'));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it('submits on enter key', async () => {
    const user = userEvent.setup();
    render(<NewAlbumDialog {...defaultProps} />);

    const input = screen.getByTestId('new-album-name-input');
    await user.type(input, 'Test Album');
    const form = input.closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockCreateAlbum).toHaveBeenCalledWith('Test Album');
    });
  });
});
