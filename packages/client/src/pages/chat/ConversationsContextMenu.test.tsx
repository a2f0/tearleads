/**
 * Tests for ConversationsContextMenu component.
 */

import type { DecryptedAiConversation } from '@tearleads/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConversationsContextMenu } from './ConversationsContextMenu';

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

describe('ConversationsContextMenu', () => {
  const defaultProps = {
    x: 100,
    y: 200,
    conversation: mockConversation,
    onClose: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn()
  };

  it('renders the context menu', () => {
    render(<ConversationsContextMenu {...defaultProps} />);

    expect(screen.getByTestId('conversation-context-menu')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renders at the specified position', () => {
    render(<ConversationsContextMenu {...defaultProps} x={150} y={250} />);

    const menu = screen.getByTestId('conversation-context-menu');
    expect(menu).toHaveStyle({ left: '150px', top: '250px' });
  });

  it('calls onRename and onClose when Rename is clicked', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(
      <ConversationsContextMenu
        {...defaultProps}
        onRename={onRename}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByTestId('conversation-context-menu-rename'));

    expect(onRename).toHaveBeenCalledWith(mockConversation);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete and onClose when Delete is clicked', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(
      <ConversationsContextMenu
        {...defaultProps}
        onDelete={onDelete}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByTestId('conversation-context-menu-delete'));

    expect(onDelete).toHaveBeenCalledWith(mockConversation);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ConversationsContextMenu {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('conversation-context-menu-backdrop'));

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key press', () => {
    const onClose = vi.fn();
    render(<ConversationsContextMenu {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('removes event listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ConversationsContextMenu {...defaultProps} onClose={onClose} />
    );

    unmount();

    // Fire escape after unmount - should not call onClose
    fireEvent.keyDown(document, { key: 'Escape' });

    // onClose should have been called 0 times after unmount
    expect(onClose).toHaveBeenCalledTimes(0);
  });

  it('renders Pencil icon for Rename', () => {
    render(<ConversationsContextMenu {...defaultProps} />);

    const renameButton = screen.getByTestId('conversation-context-menu-rename');
    expect(renameButton.querySelector('svg')).toBeInTheDocument();
  });

  it('renders Trash2 icon for Delete', () => {
    render(<ConversationsContextMenu {...defaultProps} />);

    const deleteButton = screen.getByTestId('conversation-context-menu-delete');
    expect(deleteButton.querySelector('svg')).toBeInTheDocument();
  });
});
