import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteFileDialog } from './DeleteFileDialog';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn()
  }
}));

describe('DeleteFileDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    fileName: 'test-file.txt',
    onDelete: vi.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open is true', () => {
    render(<DeleteFileDialog {...defaultProps} />);
    expect(screen.getByText('Delete File')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<DeleteFileDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete File')).not.toBeInTheDocument();
  });

  it('displays the file name in the confirmation message', () => {
    render(<DeleteFileDialog {...defaultProps} />);
    expect(screen.getByText('test-file.txt')).toBeInTheDocument();
  });

  it('calls onDelete when Delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<DeleteFileDialog {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByTestId('confirm-delete-file-button'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('calls onOpenChange with false when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<DeleteFileDialog {...defaultProps} onOpenChange={onOpenChange} />);

    await user.click(screen.getByTestId('cancel-delete-file-button'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange with false when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { container } = render(
      <DeleteFileDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await user.click(backdrop);
    }

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows "Deleting..." text while deletion is in progress', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(
      (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))
    );
    render(<DeleteFileDialog {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByTestId('confirm-delete-file-button'));

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
  });

  it('disables buttons while deletion is in progress', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(
      (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))
    );
    render(<DeleteFileDialog {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByTestId('confirm-delete-file-button'));

    expect(screen.getByTestId('confirm-delete-file-button')).toBeDisabled();
    expect(screen.getByTestId('cancel-delete-file-button')).toBeDisabled();
  });

  it('closes dialog after successful deletion', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteFileDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByTestId('confirm-delete-file-button'));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows toast error when deletion fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));
    const { unmount } = render(
      <DeleteFileDialog {...defaultProps} onDelete={onDelete} />
    );

    await user.click(screen.getByTestId('confirm-delete-file-button'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to delete file. Please try again.'
      );
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete file:',
      expect.any(Error)
    );

    unmount();
    consoleSpy.mockRestore();
  });

  it('does not close dialog on cancel when deleting', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    let resolveDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      (): Promise<void> =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        })
    );
    const { unmount } = render(
      <DeleteFileDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByTestId('confirm-delete-file-button'));
    await user.click(screen.getByTestId('cancel-delete-file-button'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveDelete?.();
    unmount();
  });
});
