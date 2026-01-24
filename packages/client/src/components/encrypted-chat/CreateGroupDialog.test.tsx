import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGroupDialog } from './CreateGroupDialog';

describe('CreateGroupDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnCreate.mockResolvedValue(undefined);
  });

  it('does not render when isOpen is false', () => {
    render(
      <CreateGroupDialog
        isOpen={false}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    expect(
      screen.queryByText('Create Encrypted Group')
    ).not.toBeInTheDocument();
  });

  it('renders dialog when isOpen is true', () => {
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    expect(screen.getByText('Create Encrypted Group')).toBeInTheDocument();
    expect(screen.getByLabelText('Group Name')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onCreate with group name when Create Group is clicked', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), 'My New Group');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    await waitFor(() => {
      expect(mockOnCreate).toHaveBeenCalledWith('My New Group');
    });
  });

  it('shows error when trying to create with empty name via Enter', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    // Button is disabled when name is empty, so use Enter key to trigger validation
    await user.type(screen.getByLabelText('Group Name'), '{Enter}');

    expect(screen.getByText('Please enter a group name')).toBeInTheDocument();
    expect(mockOnCreate).not.toHaveBeenCalled();
  });

  it('disables Create Group button when name is empty', () => {
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    expect(
      screen.getByRole('button', { name: /create group/i })
    ).toBeDisabled();
  });

  it('shows error from onCreate failure', async () => {
    mockOnCreate.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), 'My Group');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('closes dialog on successful creation', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), 'My Group');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('creates group on Enter key press', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), 'My Group{Enter}');

    await waitFor(() => {
      expect(mockOnCreate).toHaveBeenCalledWith('My Group');
    });
  });

  it('closes on Escape key press', async () => {
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), '{Escape}');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('disables buttons while creating', async () => {
    mockOnCreate.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );
    const user = userEvent.setup();
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    await user.type(screen.getByLabelText('Group Name'), 'My Group');
    await user.click(screen.getByRole('button', { name: /create group/i }));

    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });

  it('shows MLS description', () => {
    render(
      <CreateGroupDialog
        isOpen={true}
        onClose={mockOnClose}
        onCreate={mockOnCreate}
      />
    );

    expect(
      screen.getByText(/end-to-end encrypted using MLS/)
    ).toBeInTheDocument();
  });
});
