/**
 * Tests for NewConversationDialog component.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewConversationDialog } from './NewConversationDialog';

describe('NewConversationDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined)
  };

  it('renders nothing when closed', () => {
    const { container } = render(
      <NewConversationDialog {...defaultProps} open={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog when open', () => {
    render(<NewConversationDialog {...defaultProps} />);

    expect(screen.getByText('New Conversation')).toBeInTheDocument();
    expect(screen.getByText(/start a new conversation/i)).toBeInTheDocument();
  });

  it('calls onConfirm and closes when Create is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <NewConversationDialog
        {...defaultProps}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('calls onOpenChange when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <NewConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <NewConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Creating... text while creating', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(<NewConversationDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    expect(screen.getByText('Creating...')).toBeInTheDocument();

    resolveConfirm();

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('disables buttons while creating', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(<NewConversationDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    expect(screen.getByTestId('new-conversation-dialog-create')).toBeDisabled();
    expect(screen.getByTestId('new-conversation-dialog-cancel')).toBeDisabled();

    resolveConfirm();

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('handles errors gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onConfirm = vi.fn().mockRejectedValue(new Error('Test error'));
    const onOpenChange = vi.fn();

    render(
      <NewConversationDialog
        {...defaultProps}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to create conversation:',
        expect.any(Error)
      );
    });

    // Dialog should remain open after error
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    consoleError.mockRestore();
  });

  it('closes on Escape key press', () => {
    const onOpenChange = vi.fn();
    render(
      <NewConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.keyDown(screen.getByTestId('new-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close on Escape while creating', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <NewConversationDialog
        {...defaultProps}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    fireEvent.keyDown(screen.getByTestId('new-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveConfirm();

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('prevents cancel while creating', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <NewConversationDialog
        {...defaultProps}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('new-conversation-dialog-create'));

    // Try clicking backdrop while creating - should not close
    fireEvent.click(screen.getByTestId('new-conversation-dialog-backdrop'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveConfirm();

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });
});
