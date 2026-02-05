import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProvider } from '../test/test-utils.js';
import { AddMemberDialog } from './AddMemberDialog.js';

describe('AddMemberDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onAddMember: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    renderWithProvider(<AddMemberDialog {...defaultProps} />);
    expect(screen.getByText('Add Member')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderWithProvider(<AddMemberDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Add Member')).not.toBeInTheDocument();
  });

  it('adds member and calls callbacks', async () => {
    const onAddMember = vi.fn().mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();

    renderWithProvider(
      <AddMemberDialog
        {...defaultProps}
        onAddMember={onAddMember}
        onOpenChange={onOpenChange}
      />
    );

    const user = userEvent.setup();
    await user.type(screen.getByTestId('add-member-userid-input'), 'user-123');

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onAddMember).toHaveBeenCalledWith('user-123');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('disables add button when input is empty', () => {
    renderWithProvider(<AddMemberDialog {...defaultProps} />);

    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).toBeDisabled();
  });

  it('enables add button when input has value', async () => {
    renderWithProvider(<AddMemberDialog {...defaultProps} />);

    const user = userEvent.setup();
    await user.type(screen.getByTestId('add-member-userid-input'), 'user-123');

    const addButton = screen.getByRole('button', { name: 'Add' });
    expect(addButton).not.toBeDisabled();
  });

  it('closes dialog on cancel', async () => {
    const onOpenChange = vi.fn();
    renderWithProvider(
      <AddMemberDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog on backdrop click', async () => {
    const onOpenChange = vi.fn();
    renderWithProvider(
      <AddMemberDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('add-member-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows adding state', () => {
    renderWithProvider(<AddMemberDialog {...defaultProps} isAdding={true} />);

    expect(screen.getByRole('button', { name: 'Adding...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('trims whitespace from user ID', async () => {
    const onAddMember = vi.fn().mockResolvedValueOnce(undefined);

    renderWithProvider(
      <AddMemberDialog {...defaultProps} onAddMember={onAddMember} />
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId('add-member-userid-input'),
      '  user-123  '
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onAddMember).toHaveBeenCalledWith('user-123');
    });
  });

  it('displays error message when adding member fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAddMember = vi
      .fn()
      .mockRejectedValueOnce(new Error('User not found'));

    renderWithProvider(
      <AddMemberDialog {...defaultProps} onAddMember={onAddMember} />
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId('add-member-userid-input'),
      'unknown-user'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
