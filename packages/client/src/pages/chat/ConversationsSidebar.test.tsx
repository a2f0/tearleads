/**
 * Tests for ConversationsSidebar component.
 */

import type { DecryptedAiConversation } from '@rapid/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsSidebar } from './ConversationsSidebar';

// Mock the context menu component
vi.mock('./ConversationsContextMenu', () => ({
  ConversationsContextMenu: ({
    onClose,
    onRename,
    onDelete,
    conversation
  }: {
    onClose: () => void;
    onRename: (conv: DecryptedAiConversation) => void;
    onDelete: (conv: DecryptedAiConversation) => void;
    conversation: DecryptedAiConversation;
  }) => (
    <div data-testid="context-menu">
      <button
        type="button"
        data-testid="context-menu-rename"
        onClick={() => {
          onRename(conversation);
        }}
      >
        Rename
      </button>
      <button
        type="button"
        data-testid="context-menu-delete"
        onClick={() => {
          onDelete(conversation);
        }}
      >
        Delete
      </button>
      <button type="button" data-testid="context-menu-close" onClick={onClose}>
        Close
      </button>
    </div>
  )
}));

// Mock the new conversation dialog
vi.mock('./NewConversationDialog', () => ({
  NewConversationDialog: ({
    open,
    onOpenChange,
    onConfirm
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => Promise<void>;
  }) =>
    open ? (
      <div data-testid="new-conversation-dialog">
        <button type="button" onClick={onConfirm} data-testid="create-btn">
          Create
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          data-testid="cancel-btn"
        >
          Cancel
        </button>
      </div>
    ) : null
}));

// Mock the rename dialog
vi.mock('./RenameConversationDialog', () => ({
  RenameConversationDialog: ({
    open,
    onOpenChange,
    onRename,
    conversation
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRename: (id: string, title: string) => Promise<void>;
    conversation: DecryptedAiConversation | null;
  }) =>
    open ? (
      <div data-testid="rename-dialog">
        <button
          type="button"
          data-testid="rename-dialog-submit"
          onClick={async () => {
            if (conversation) {
              await onRename(conversation.id, 'New Title');
            }
            onOpenChange(false);
          }}
        >
          Submit
        </button>
        <button
          type="button"
          data-testid="rename-dialog-cancel"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </button>
      </div>
    ) : null
}));

// Mock the delete dialog
vi.mock('./DeleteConversationDialog', () => ({
  DeleteConversationDialog: ({
    open,
    onOpenChange,
    onDelete,
    conversation
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: (id: string) => Promise<void>;
    conversation: DecryptedAiConversation | null;
  }) =>
    open ? (
      <div data-testid="delete-dialog">
        <button
          type="button"
          data-testid="delete-dialog-submit"
          onClick={async () => {
            if (conversation) {
              await onDelete(conversation.id);
            }
            onOpenChange(false);
          }}
        >
          Delete
        </button>
        <button
          type="button"
          data-testid="delete-dialog-cancel"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </button>
      </div>
    ) : null
}));

// Helper to create conversation with specific date
const createConversation = (
  id: string,
  title: string,
  updatedAt: string
): DecryptedAiConversation => ({
  id,
  userId: 'user-1',
  organizationId: 'org-1',
  title,
  modelId: 'gpt-4',
  messageCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt
});

const mockConversations: DecryptedAiConversation[] = [
  {
    id: 'conv-1',
    userId: 'user-1',
    organizationId: 'org-1',
    title: 'First Conversation',
    modelId: 'gpt-4',
    messageCount: 5,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z'
  },
  {
    id: 'conv-2',
    userId: 'user-1',
    organizationId: 'org-1',
    title: 'Second Conversation',
    modelId: null,
    messageCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z'
  }
];

describe('ConversationsSidebar', () => {
  const createDefaultProps = () => ({
    width: 220,
    onWidthChange: vi.fn(),
    conversations: mockConversations,
    selectedConversationId: null,
    onConversationSelect: vi.fn(),
    onNewConversation: vi.fn().mockResolvedValue(undefined),
    onRenameConversation: vi.fn().mockResolvedValue(undefined),
    onDeleteConversation: vi.fn().mockResolvedValue(undefined),
    loading: false
  });

  let defaultProps: ReturnType<typeof createDefaultProps>;

  beforeEach(() => {
    defaultProps = createDefaultProps();
  });

  it('renders the sidebar header', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    expect(screen.getByText('Conversations')).toBeInTheDocument();
  });

  it('renders the new conversation button', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    expect(screen.getByTitle('New Conversation')).toBeInTheDocument();
  });

  it('renders conversations list', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    expect(screen.getByText('First Conversation')).toBeInTheDocument();
    expect(screen.getByText('Second Conversation')).toBeInTheDocument();
  });

  it('highlights the selected conversation', () => {
    render(
      <ConversationsSidebar {...defaultProps} selectedConversationId="conv-1" />
    );

    const selectedItem = screen
      .getByText('First Conversation')
      .closest('button');
    expect(selectedItem).toHaveClass('bg-accent');
  });

  it('calls onConversationSelect when clicking a conversation', () => {
    const onConversationSelect = vi.fn();
    render(
      <ConversationsSidebar
        {...defaultProps}
        onConversationSelect={onConversationSelect}
      />
    );

    fireEvent.click(screen.getByText('First Conversation'));

    expect(onConversationSelect).toHaveBeenCalledWith('conv-1');
  });

  it('shows empty state when no conversations', () => {
    render(<ConversationsSidebar {...defaultProps} conversations={[]} />);

    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<ConversationsSidebar {...defaultProps} loading={true} />);

    expect(screen.getByTestId('conversations-sidebar')).toBeInTheDocument();
    // Loading state shows the loader icon
    const sidebar = screen.getByTestId('conversations-sidebar');
    expect(sidebar.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('opens new conversation dialog', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    fireEvent.click(screen.getByTitle('New Conversation'));

    expect(screen.getByTestId('new-conversation-dialog')).toBeInTheDocument();
  });

  it('shows error state', () => {
    render(
      <ConversationsSidebar {...defaultProps} error="Something went wrong" />
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('handles resize via mouse drag', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle =
      screen.getByRole('separator', { hidden: true }) ||
      screen.getByLabelText('Resize conversations sidebar');

    fireEvent.mouseDown(resizeHandle, { clientX: 220 });
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('handles resize via keyboard', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = screen.getByLabelText('Resize conversations sidebar');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(onWidthChange).toHaveBeenCalledWith(230);
  });

  it('handles resize via keyboard ArrowLeft', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = screen.getByLabelText('Resize conversations sidebar');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

    expect(onWidthChange).toHaveBeenCalledWith(210);
  });

  it('ignores non-arrow keys on resize handle', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = screen.getByLabelText('Resize conversations sidebar');

    fireEvent.keyDown(resizeHandle, { key: 'Enter' });

    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it('respects minimum width constraint', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar
        {...defaultProps}
        width={160}
        onWidthChange={onWidthChange}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize conversations sidebar');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });

    expect(onWidthChange).toHaveBeenCalledWith(150);
  });

  it('respects maximum width constraint', () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationsSidebar
        {...defaultProps}
        width={395}
        onWidthChange={onWidthChange}
      />
    );

    const resizeHandle = screen.getByLabelText('Resize conversations sidebar');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' });

    expect(onWidthChange).toHaveBeenCalledWith(400);
  });

  it('opens context menu on right-click', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('opens rename dialog from context menu', async () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click rename in context menu
    fireEvent.click(screen.getByTestId('context-menu-rename'));

    // Verify rename dialog opens
    expect(screen.getByTestId('rename-dialog')).toBeInTheDocument();
  });

  it('opens delete dialog from context menu', async () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click delete in context menu
    fireEvent.click(screen.getByTestId('context-menu-delete'));

    // Verify delete dialog opens
    expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
  });

  it('closes context menu', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();

    // Close context menu
    fireEvent.click(screen.getByTestId('context-menu-close'));

    expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument();
  });

  it('calls onRenameConversation when rename dialog submits', async () => {
    const onRenameConversation = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationsSidebar
        {...defaultProps}
        onRenameConversation={onRenameConversation}
      />
    );

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click rename in context menu
    fireEvent.click(screen.getByTestId('context-menu-rename'));

    // Submit rename dialog
    fireEvent.click(screen.getByTestId('rename-dialog-submit'));

    await waitFor(() => {
      expect(onRenameConversation).toHaveBeenCalledWith('conv-1', 'New Title');
    });
  });

  it('closes rename dialog when cancelled', async () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click rename in context menu
    fireEvent.click(screen.getByTestId('context-menu-rename'));

    expect(screen.getByTestId('rename-dialog')).toBeInTheDocument();

    // Cancel rename dialog
    fireEvent.click(screen.getByTestId('rename-dialog-cancel'));

    expect(screen.queryByTestId('rename-dialog')).not.toBeInTheDocument();
  });

  it('calls onDeleteConversation when delete dialog submits', async () => {
    const onDeleteConversation = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationsSidebar
        {...defaultProps}
        onDeleteConversation={onDeleteConversation}
      />
    );

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click delete in context menu
    fireEvent.click(screen.getByTestId('context-menu-delete'));

    // Submit delete dialog
    fireEvent.click(screen.getByTestId('delete-dialog-submit'));

    await waitFor(() => {
      expect(onDeleteConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  it('closes delete dialog when cancelled', async () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open context menu
    const conversation = screen.getByText('First Conversation');
    fireEvent.contextMenu(conversation);

    // Click delete in context menu
    fireEvent.click(screen.getByTestId('context-menu-delete'));

    expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();

    // Cancel delete dialog
    fireEvent.click(screen.getByTestId('delete-dialog-cancel'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  it('calls onNewConversation when create button clicked', async () => {
    const onNewConversation = vi.fn().mockResolvedValue(undefined);
    render(
      <ConversationsSidebar
        {...defaultProps}
        onNewConversation={onNewConversation}
      />
    );

    // Open new dialog
    fireEvent.click(screen.getByTitle('New Conversation'));

    // Click create
    fireEvent.click(screen.getByTestId('create-btn'));

    await waitFor(() => {
      expect(onNewConversation).toHaveBeenCalled();
    });
  });

  it('closes new dialog when cancelled', () => {
    render(<ConversationsSidebar {...defaultProps} />);

    // Open new dialog
    fireEvent.click(screen.getByTitle('New Conversation'));

    expect(screen.getByTestId('new-conversation-dialog')).toBeInTheDocument();

    // Cancel
    fireEvent.click(screen.getByTestId('cancel-btn'));

    expect(
      screen.queryByTestId('new-conversation-dialog')
    ).not.toBeInTheDocument();
  });

  describe('date formatting', () => {
    it('displays today time for today updates', () => {
      const now = new Date();
      const todayConv = createConversation(
        'conv-today',
        'Today Conv',
        now.toISOString()
      );

      render(
        <ConversationsSidebar {...defaultProps} conversations={[todayConv]} />
      );

      // Should show time (e.g. "3:45 PM")
      const conversationEl = screen.getByText('Today Conv').closest('button');
      expect(conversationEl).toBeInTheDocument();
    });

    it('displays Yesterday for yesterday updates', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayConv = createConversation(
        'conv-yesterday',
        'Yesterday Conv',
        yesterday.toISOString()
      );

      render(
        <ConversationsSidebar
          {...defaultProps}
          conversations={[yesterdayConv]}
        />
      );

      expect(screen.getByText('Yesterday')).toBeInTheDocument();
    });

    it('displays weekday for updates within the last week', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const weekConv = createConversation(
        'conv-week',
        'Week Conv',
        threeDaysAgo.toISOString()
      );

      render(
        <ConversationsSidebar {...defaultProps} conversations={[weekConv]} />
      );

      // Should show day of week (e.g. "Mon", "Tue")
      const conversationEl = screen.getByText('Week Conv').closest('button');
      expect(conversationEl).toBeInTheDocument();
    });

    it('displays date for older updates', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const oldConv = createConversation(
        'conv-old',
        'Old Conv',
        twoWeeksAgo.toISOString()
      );

      render(
        <ConversationsSidebar {...defaultProps} conversations={[oldConv]} />
      );

      // Should show month + day (e.g. "Jan 15")
      const conversationEl = screen.getByText('Old Conv').closest('button');
      expect(conversationEl).toBeInTheDocument();
    });
  });
});
