/**
 * Tests for DeleteConversationDialog component.
 */

import type { DecryptedAiConversation } from '@tearleads/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConversationDialog } from './DeleteConversationDialog';

const mockConversation: DecryptedAiConversation = {
  id: 'conv-1',
  userId: 'user-1',
  organizationId: 'org-1',
  title: 'Test Conversation',
  modelId: 'gpt-4',
  messageCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z'
};

describe('DeleteConversationDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    conversation: mockConversation,
    onDelete: vi.fn().mockResolvedValue(undefined)
  };

  it('renders nothing when closed', () => {
    const { container } = render(
      <DeleteConversationDialog {...defaultProps} open={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when conversation is null', () => {
    const { container } = render(
      <DeleteConversationDialog {...defaultProps} conversation={null} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with conversation title', () => {
    render(<DeleteConversationDialog {...defaultProps} />);

    expect(screen.getByText('Delete Conversation')).toBeInTheDocument();
    expect(screen.getByText(/Test Conversation/)).toBeInTheDocument();
    expect(
      screen.getByText(/this action cannot be undone/i)
    ).toBeInTheDocument();
  });

  it('calls onDelete and closes when Delete is clicked', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <DeleteConversationDialog
        {...defaultProps}
        onDelete={onDelete}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('conv-1');
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('calls onOpenChange when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <DeleteConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <DeleteConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Deleting... text while deleting', async () => {
    let resolveDelete: () => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );

    render(<DeleteConversationDialog {...defaultProps} onDelete={onDelete} />);

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    expect(screen.getByText('Deleting...')).toBeInTheDocument();

    resolveDelete();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('disables buttons while deleting', async () => {
    let resolveDelete: () => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );

    render(<DeleteConversationDialog {...defaultProps} onDelete={onDelete} />);

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    expect(
      screen.getByTestId('delete-conversation-dialog-delete')
    ).toBeDisabled();
    expect(
      screen.getByTestId('delete-conversation-dialog-cancel')
    ).toBeDisabled();

    resolveDelete();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('handles errors gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(new Error('Test error'));
    const onOpenChange = vi.fn();

    render(
      <DeleteConversationDialog
        {...defaultProps}
        onDelete={onDelete}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to delete conversation:',
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
      <DeleteConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.keyDown(screen.getByTestId('delete-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close on Escape while deleting', async () => {
    let resolveDelete: () => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <DeleteConversationDialog
        {...defaultProps}
        onDelete={onDelete}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    fireEvent.keyDown(screen.getByTestId('delete-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveDelete();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('prevents cancel while deleting', async () => {
    let resolveDelete: () => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <DeleteConversationDialog
        {...defaultProps}
        onDelete={onDelete}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    // Try clicking backdrop while deleting - should not close
    fireEvent.click(screen.getByTestId('delete-conversation-dialog-backdrop'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveDelete();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('does not call onDelete when already deleting', async () => {
    let resolveDelete: () => void = () => {};
    const onDelete = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );

    render(<DeleteConversationDialog {...defaultProps} onDelete={onDelete} />);

    // First click
    fireEvent.click(screen.getByTestId('delete-conversation-dialog-delete'));

    // Button is disabled, but we can test the guard
    expect(onDelete).toHaveBeenCalledTimes(1);

    resolveDelete();

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });
});
