import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GroupsAdmin } from './GroupsAdmin';

vi.mock('@/components/admin-groups', () => ({
  GroupsList: ({ onCreateClick }: { onCreateClick?: () => void }) => (
    <div data-testid="groups-list">
      <button type="button" onClick={onCreateClick}>
        Create from list
      </button>
    </div>
  ),
  CreateGroupDialog: ({
    open,
    onOpenChange,
    onCreated
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: () => void;
  }) =>
    open ? (
      <div data-testid="create-group-dialog">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
        <button
          type="button"
          data-testid="trigger-created"
          onClick={() => {
            onOpenChange(false);
            onCreated?.();
          }}
        >
          Trigger Created
        </button>
      </div>
    ) : null
}));

describe('GroupsAdmin', () => {
  function renderGroupsAdmin(showBackLink = true) {
    return render(
      <MemoryRouter>
        <GroupsAdmin showBackLink={showBackLink} />
      </MemoryRouter>
    );
  }

  it('renders the heading and groups list', () => {
    renderGroupsAdmin();

    expect(
      screen.getByRole('heading', { name: 'Groups Admin' })
    ).toBeInTheDocument();
    expect(screen.getByText('Manage user groups')).toBeInTheDocument();
    expect(screen.getByTestId('groups-list')).toBeInTheDocument();
  });

  it('shows back link by default', () => {
    renderGroupsAdmin();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('hides back link when disabled', () => {
    renderGroupsAdmin(false);
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('opens create dialog when button is clicked', async () => {
    const user = userEvent.setup();
    renderGroupsAdmin();

    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Group' }));

    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();
  });

  it('opens create dialog when create is clicked from list', async () => {
    const user = userEvent.setup();
    renderGroupsAdmin();

    await user.click(screen.getByText('Create from list'));

    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();
  });

  it('closes dialog when group is created', async () => {
    const user = userEvent.setup();
    renderGroupsAdmin();

    await user.click(screen.getByRole('button', { name: 'Create Group' }));
    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('trigger-created'));

    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument();
  });
});
