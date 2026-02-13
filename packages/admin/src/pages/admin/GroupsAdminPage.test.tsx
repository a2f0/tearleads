import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupsAdminPage } from './GroupsAdminPage';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@admin/components/admin-groups', () => ({
  GroupsList: ({
    onGroupSelect
  }: {
    onGroupSelect: (groupId: string) => void;
  }) => (
    <div data-testid="groups-list">
      <button type="button" onClick={() => onGroupSelect('group-123')}>
        Select Group
      </button>
    </div>
  ),
  CreateGroupDialog: () => null
}));

describe('GroupsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to group detail page when group is selected', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <GroupsAdminPage />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Select Group'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/groups/group-123');
    });
  });

  it('renders GroupsAdmin component', () => {
    render(
      <MemoryRouter>
        <GroupsAdminPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Groups Admin' })
    ).toBeInTheDocument();
  });
});
