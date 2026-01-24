import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddMembersDialog, type UserInfo } from './AddMembersDialog';

describe('AddMembersDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnAdd = vi.fn();

  const mockUsers: UserInfo[] = [
    { id: 'user-1', email: 'alice@example.com', displayName: 'Alice' },
    { id: 'user-2', email: 'bob@example.com', displayName: 'Bob' },
    { id: 'user-3', email: 'charlie@example.com' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAdd.mockResolvedValue(undefined);
  });

  it('does not render when isOpen is false', () => {
    render(
      <AddMembersDialog
        isOpen={false}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    expect(screen.queryByText('Add Members')).not.toBeInTheDocument();
  });

  it('renders dialog when isOpen is true', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Add Members' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Search Users')).toBeInTheDocument();
  });

  it('renders list of available users', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('charlie')).toBeInTheDocument();
  });

  it('filters out existing members', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={['user-1']}
      />
    );

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('filters users by search query', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    await user.type(screen.getByLabelText('Search Users'), 'alice');

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('selects and deselects users on click', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    const aliceButton = screen.getByText('Alice').closest('button');
    expect(aliceButton).not.toBeNull();

    // Initially the add button shows " Members" with disabled state
    const addButton = screen.getByRole('button', { name: /add.*members/i });
    expect(addButton).toBeDisabled();

    // Select Alice
    await user.click(aliceButton as HTMLButtonElement);
    expect(
      screen.getByRole('button', { name: 'Add 1 Member' })
    ).toBeInTheDocument();

    // Deselect Alice
    await user.click(aliceButton as HTMLButtonElement);
    expect(addButton).toBeDisabled();
  });

  it('allows selecting multiple users', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    const aliceButton = screen.getByText('Alice').closest('button');
    const bobButton = screen.getByText('Bob').closest('button');
    await user.click(aliceButton as HTMLButtonElement);
    await user.click(bobButton as HTMLButtonElement);

    expect(screen.getByText('Add 2 Members')).toBeInTheDocument();
  });

  it('calls onAdd with selected user IDs', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    const aliceButton = screen.getByText('Alice').closest('button');
    const bobButton = screen.getByText('Bob').closest('button');
    await user.click(aliceButton as HTMLButtonElement);
    await user.click(bobButton as HTMLButtonElement);
    await user.click(screen.getByText('Add 2 Members'));

    await waitFor(() => {
      expect(mockOnAdd).toHaveBeenCalledWith(['user-1', 'user-2']);
    });
  });

  it('disables Add button when no users are selected', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    // Button should be disabled when no users are selected
    expect(
      screen.getByRole('button', { name: /add.*members/i })
    ).toBeDisabled();
    expect(mockOnAdd).not.toHaveBeenCalled();
  });

  it('shows error from onAdd failure', async () => {
    mockOnAdd.mockRejectedValue(new Error('Failed to add'));
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    const aliceButton = screen.getByText('Alice').closest('button');
    await user.click(aliceButton as HTMLButtonElement);
    await user.click(screen.getByText('Add 1 Member'));

    await waitFor(() => {
      expect(screen.getByText('Failed to add')).toBeInTheDocument();
    });
  });

  it('closes dialog on successful add', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    const aliceButton = screen.getByText('Alice').closest('button');
    await user.click(aliceButton as HTMLButtonElement);
    await user.click(screen.getByText('Add 1 Member'));

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows empty state when all users are already members', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={['user-1', 'user-2', 'user-3']}
      />
    );

    expect(
      screen.getByText('No more users available to add')
    ).toBeInTheDocument();
  });

  it('shows no match message when search has no results', async () => {
    const user = userEvent.setup();
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    await user.type(screen.getByLabelText('Search Users'), 'xyz');

    expect(screen.getByText('No users match your search')).toBeInTheDocument();
  });

  it('shows user initials as avatar', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('shows email for all users', () => {
    render(
      <AddMembersDialog
        isOpen={true}
        onClose={mockOnClose}
        onAdd={mockOnAdd}
        availableUsers={mockUsers}
        existingMemberIds={[]}
      />
    );

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('charlie@example.com')).toBeInTheDocument();
  });
});
