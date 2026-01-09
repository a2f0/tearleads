import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeletePhotoDialog } from './DeletePhotoDialog';

// Mock sonner toast
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (message: string) => mockToastError(message)
  }
}));

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  photoName?: string;
  onDelete?: () => Promise<void>;
}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    photoName: 'test-photo.jpg',
    onDelete: vi.fn().mockResolvedValue(undefined)
  };

  return render(
    <ThemeProvider>
      <DeletePhotoDialog {...defaultProps} {...props} />
    </ThemeProvider>
  );
}

describe('DeletePhotoDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToastError.mockClear();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('delete-photo-dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });
    expect(screen.getByTestId('delete-photo-dialog')).toBeInTheDocument();
  });

  it('displays photo name in confirmation message', () => {
    renderDialog({ photoName: 'my-vacation.jpg' });
    expect(screen.getByText('my-vacation.jpg')).toBeInTheDocument();
  });

  it('calls onOpenChange with false when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('cancel-delete-photo-button'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onDelete and onOpenChange when delete is confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onDelete, onOpenChange });

    await user.click(screen.getByTestId('confirm-delete-photo-button'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows deleting state while delete is in progress', async () => {
    let resolveDelete: () => void = () => {};
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDelete = vi.fn().mockReturnValue(deletePromise);
    const user = userEvent.setup();
    renderDialog({ onDelete });

    await user.click(screen.getByTestId('confirm-delete-photo-button'));

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-delete-photo-button')).toBeDisabled();
    expect(screen.getByTestId('cancel-delete-photo-button')).toBeDisabled();

    resolveDelete();
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('closes dialog when backdrop is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    const backdrop = screen.getByTestId(
      'delete-photo-dialog'
    ).previousElementSibling;
    expect(backdrop).not.toBeNull();
    if (!backdrop) {
      throw new Error('Missing backdrop element.');
    }
    await user.click(backdrop);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('handles delete error and shows toast', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(new Error('Delete failed'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onDelete, onOpenChange });

    await user.click(screen.getByTestId('confirm-delete-photo-button'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to delete photo. Please try again.'
      );
    });

    consoleError.mockRestore();
  });

  it('prevents backdrop click from closing while deleting', async () => {
    let resolveDelete: () => void = () => {};
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const onDelete = vi.fn().mockReturnValue(deletePromise);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onDelete, onOpenChange });

    await user.click(screen.getByTestId('confirm-delete-photo-button'));

    expect(screen.getByText('Deleting...')).toBeInTheDocument();

    const backdrop = screen.getByTestId(
      'delete-photo-dialog'
    ).previousElementSibling;
    expect(backdrop).not.toBeNull();
    if (!backdrop) {
      throw new Error('Missing backdrop element.');
    }
    await user.click(backdrop);

    expect(onOpenChange).not.toHaveBeenCalled();

    resolveDelete();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
