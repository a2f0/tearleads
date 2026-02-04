/**
 * Tests for RenameConversationDialog component.
 */

import type { DecryptedAiConversation } from '@rapid/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RenameConversationDialog } from './RenameConversationDialog';

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

describe('RenameConversationDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    conversation: mockConversation,
    onRename: vi.fn().mockResolvedValue(undefined)
  };

  it('renders nothing when closed', () => {
    const { container } = render(
      <RenameConversationDialog {...defaultProps} open={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when conversation is null', () => {
    const { container } = render(
      <RenameConversationDialog {...defaultProps} conversation={null} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with current title', () => {
    render(<RenameConversationDialog {...defaultProps} />);

    expect(screen.getByText('Rename Conversation')).toBeInTheDocument();
    const input = screen.getByTestId('rename-conversation-title-input');
    expect(input).toHaveValue('Test Conversation');
  });

  it('updates the input value', () => {
    render(<RenameConversationDialog {...defaultProps} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: 'New Title' } });

    expect(input).toHaveValue('New Title');
  });

  it('calls onRename and closes when form is submitted', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <RenameConversationDialog
        {...defaultProps}
        onRename={onRename}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('conv-1', 'New Title');
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('trims the title before renaming', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameConversationDialog {...defaultProps} onRename={onRename} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: '  Trimmed Title  ' } });
    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('conv-1', 'Trimmed Title');
    });
  });

  it('disables Rename button when title is empty', () => {
    render(<RenameConversationDialog {...defaultProps} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: '' } });

    expect(
      screen.getByTestId('rename-conversation-dialog-rename')
    ).toBeDisabled();
  });

  it('disables Rename button when title is whitespace only', () => {
    render(<RenameConversationDialog {...defaultProps} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: '   ' } });

    expect(
      screen.getByTestId('rename-conversation-dialog-rename')
    ).toBeDisabled();
  });

  it('calls onOpenChange when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <RenameConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <RenameConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Renaming... text while renaming', async () => {
    let resolveRename: () => void = () => {};
    const onRename = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        })
    );

    render(<RenameConversationDialog {...defaultProps} onRename={onRename} />);

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    expect(screen.getByText('Renaming...')).toBeInTheDocument();

    resolveRename();

    await waitFor(() => {
      expect(onRename).toHaveBeenCalled();
    });
  });

  it('disables buttons and input while renaming', async () => {
    let resolveRename: () => void = () => {};
    const onRename = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        })
    );

    render(<RenameConversationDialog {...defaultProps} onRename={onRename} />);

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    expect(
      screen.getByTestId('rename-conversation-dialog-rename')
    ).toBeDisabled();
    expect(
      screen.getByTestId('rename-conversation-dialog-cancel')
    ).toBeDisabled();
    expect(
      screen.getByTestId('rename-conversation-title-input')
    ).toBeDisabled();

    resolveRename();

    await waitFor(() => {
      expect(onRename).toHaveBeenCalled();
    });
  });

  it('handles errors gracefully', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const onRename = vi.fn().mockRejectedValue(new Error('Test error'));
    const onOpenChange = vi.fn();

    render(
      <RenameConversationDialog
        {...defaultProps}
        onRename={onRename}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to rename conversation:',
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
      <RenameConversationDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    fireEvent.keyDown(screen.getByTestId('rename-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close on Escape while renaming', async () => {
    let resolveRename: () => void = () => {};
    const onRename = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <RenameConversationDialog
        {...defaultProps}
        onRename={onRename}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    fireEvent.keyDown(screen.getByTestId('rename-conversation-dialog'), {
      key: 'Escape'
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveRename();

    await waitFor(() => {
      expect(onRename).toHaveBeenCalled();
    });
  });

  it('prevents cancel while renaming', async () => {
    let resolveRename: () => void = () => {};
    const onRename = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRename = resolve;
        })
    );
    const onOpenChange = vi.fn();

    render(
      <RenameConversationDialog
        {...defaultProps}
        onRename={onRename}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId('rename-conversation-dialog-rename'));

    // Try clicking backdrop while renaming - should not close
    fireEvent.click(screen.getByTestId('rename-conversation-dialog-backdrop'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveRename();

    await waitFor(() => {
      expect(onRename).toHaveBeenCalled();
    });
  });

  it('submits on form submission', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameConversationDialog {...defaultProps} onRename={onRename} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    fireEvent.change(input, { target: { value: 'New Title' } });
    const form = input.closest('form');
    if (form) {
      fireEvent.submit(form);
    }

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('conv-1', 'New Title');
    });
  });

  it('populates title when dialog opens', () => {
    const { rerender } = render(
      <RenameConversationDialog {...defaultProps} open={false} />
    );

    rerender(<RenameConversationDialog {...defaultProps} open={true} />);

    const input = screen.getByTestId('rename-conversation-title-input');
    expect(input).toHaveValue('Test Conversation');
  });

  it('updates title when conversation changes', () => {
    const { rerender } = render(<RenameConversationDialog {...defaultProps} />);

    const newConversation: DecryptedAiConversation = {
      ...mockConversation,
      title: 'Different Title'
    };

    rerender(
      <RenameConversationDialog
        {...defaultProps}
        conversation={newConversation}
      />
    );

    const input = screen.getByTestId('rename-conversation-title-input');
    expect(input).toHaveValue('Different Title');
  });
});
