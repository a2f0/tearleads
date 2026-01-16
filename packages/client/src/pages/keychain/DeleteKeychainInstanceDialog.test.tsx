import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteKeychainInstanceDialog } from './DeleteKeychainInstanceDialog';

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  instanceName?: string;
  onDelete?: () => Promise<void>;
}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    instanceName: 'Test Instance',
    onDelete: vi.fn().mockResolvedValue(undefined)
  };

  return render(
    <ThemeProvider>
      <DeleteKeychainInstanceDialog {...defaultProps} {...props} />
    </ThemeProvider>
  );
}

describe('DeleteKeychainInstanceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(
      screen.queryByTestId('delete-keychain-instance-dialog')
    ).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });
    expect(
      screen.getByTestId('delete-keychain-instance-dialog')
    ).toBeInTheDocument();
  });

  it('displays instance name in confirmation message', () => {
    renderDialog({ instanceName: 'Alpha Instance' });
    expect(screen.getByText('Alpha Instance')).toBeInTheDocument();
  });

  it('calls onOpenChange with false when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('cancel-delete-instance'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onDelete and onOpenChange when delete is confirmed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onDelete, onOpenChange });

    await user.click(screen.getByTestId('confirm-delete-instance'));

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

    await user.click(screen.getByTestId('confirm-delete-instance'));

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-delete-instance')).toBeDisabled();
    expect(screen.getByTestId('cancel-delete-instance')).toBeDisabled();

    resolveDelete();
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('closes dialog when backdrop is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('delete-instance-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
