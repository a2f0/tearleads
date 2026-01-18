import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmingLabel?: string;
  onConfirm?: () => Promise<void>;
  variant?: 'default' | 'destructive';
}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Test Title',
    description: 'Test description',
    onConfirm: vi.fn().mockResolvedValue(undefined)
  };

  return render(
    <ThemeProvider>
      <ConfirmDialog {...defaultProps} {...props} />
    </ThemeProvider>
  );
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
  });

  it('displays title and description', () => {
    renderDialog({ title: 'Custom Title', description: 'Custom description' });
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });

  it('uses custom button labels', () => {
    renderDialog({
      confirmLabel: 'Yes, delete',
      cancelLabel: 'No, keep it'
    });
    expect(screen.getByText('Yes, delete')).toBeInTheDocument();
    expect(screen.getByText('No, keep it')).toBeInTheDocument();
  });

  it('calls onOpenChange with false when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('confirm-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onConfirm and onOpenChange when confirm is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onConfirm, onOpenChange });

    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows confirming state while confirm is in progress', async () => {
    let resolveConfirm: () => void = () => {};
    const confirmPromise = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirm = vi.fn().mockReturnValue(confirmPromise);
    const user = userEvent.setup();
    renderDialog({ onConfirm, confirmingLabel: 'Processing...' });

    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(screen.getByText('Processing...')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeDisabled();

    resolveConfirm();
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('closes dialog when backdrop is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('confirm-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders ReactNode description', () => {
    renderDialog({
      description: (
        <p>
          Are you sure you want to delete <strong>test item</strong>?
        </p>
      )
    });
    expect(screen.getByText('test item')).toBeInTheDocument();
  });

  it('closes dialog when escape key is pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close on escape when confirming', async () => {
    let resolveConfirm: () => void = () => {};
    const confirmPromise = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirm = vi.fn().mockReturnValue(confirmPromise);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onConfirm, onOpenChange });

    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();

    await user.keyboard('{Escape}');

    // onOpenChange should not be called for escape while confirming
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveConfirm();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('traps focus within the dialog', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const cancelButton = screen.getByTestId('confirm-dialog-cancel');
    const confirmButton = screen.getByTestId('confirm-dialog-confirm');

    // Focus the cancel button first
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);

    // Tab should move to confirm button
    await user.tab();
    expect(document.activeElement).toBe(confirmButton);

    // Tab again should wrap back to cancel button (focus trap)
    await user.tab();
    expect(document.activeElement).toBe(cancelButton);
  });

  it('traps focus in reverse with shift+tab', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const cancelButton = screen.getByTestId('confirm-dialog-cancel');
    const confirmButton = screen.getByTestId('confirm-dialog-confirm');

    // Focus the cancel button first
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);

    // Shift+Tab should wrap to confirm button (focus trap)
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirmButton);
  });

  it('resets confirming state when reopened after successful confirmation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    const dialogProps = {
      onOpenChange,
      title: 'Test',
      description: 'Test',
      confirmLabel: 'Delete',
      confirmingLabel: 'Deleting...',
      onConfirm
    };

    const { rerender } = render(
      <ThemeProvider>
        <ConfirmDialog open={true} {...dialogProps} />
      </ThemeProvider>
    );

    // Click confirm and wait for it to complete
    await user.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Close the dialog
    rerender(
      <ThemeProvider>
        <ConfirmDialog open={false} {...dialogProps} />
      </ThemeProvider>
    );

    // Reopen the dialog
    rerender(
      <ThemeProvider>
        <ConfirmDialog open={true} {...dialogProps} />
      </ThemeProvider>
    );

    // Should show "Delete" not "Deleting..." and buttons should be enabled
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Deleting...')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-confirm')).not.toBeDisabled();
    expect(screen.getByTestId('confirm-dialog-cancel')).not.toBeDisabled();
  });
});
