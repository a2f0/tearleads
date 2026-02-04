import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProvider } from '../test/test-utils.js';
import { NewGroupDialog } from './NewGroupDialog.js';

describe('NewGroupDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onGroupCreate: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    renderWithProvider(<NewGroupDialog {...defaultProps} />);
    expect(screen.getByText('New Group')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderWithProvider(<NewGroupDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('New Group')).not.toBeInTheDocument();
  });

  it('creates group and calls callbacks', async () => {
    const onGroupCreate = vi.fn().mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();

    renderWithProvider(
      <NewGroupDialog
        {...defaultProps}
        onGroupCreate={onGroupCreate}
        onOpenChange={onOpenChange}
      />
    );

    const user = userEvent.setup();
    await user.type(screen.getByTestId('new-group-name-input'), 'Test Group');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onGroupCreate).toHaveBeenCalledWith('Test Group');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('disables create button when input is empty', () => {
    renderWithProvider(<NewGroupDialog {...defaultProps} />);

    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).toBeDisabled();
  });

  it('enables create button when input has value', async () => {
    renderWithProvider(<NewGroupDialog {...defaultProps} />);

    const user = userEvent.setup();
    await user.type(screen.getByTestId('new-group-name-input'), 'My Group');

    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).not.toBeDisabled();
  });

  it('closes dialog on cancel', async () => {
    const onOpenChange = vi.fn();
    renderWithProvider(
      <NewGroupDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog on backdrop click', async () => {
    const onOpenChange = vi.fn();
    renderWithProvider(
      <NewGroupDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('new-group-dialog-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows creating state', () => {
    renderWithProvider(<NewGroupDialog {...defaultProps} isCreating={true} />);

    expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('trims whitespace from group name', async () => {
    const onGroupCreate = vi.fn().mockResolvedValueOnce(undefined);

    renderWithProvider(
      <NewGroupDialog {...defaultProps} onGroupCreate={onGroupCreate} />
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId('new-group-name-input'),
      '  Trimmed Group  '
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onGroupCreate).toHaveBeenCalledWith('Trimmed Group');
    });
  });
});
