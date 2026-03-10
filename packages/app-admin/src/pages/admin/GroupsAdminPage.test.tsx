import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupsAdminPage } from './GroupsAdminPage';

const mockGetContext = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    adminV2: {
      getContext: () => mockGetContext()
    }
  }
}));

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
    mockGetContext.mockResolvedValue({
      isRootAdmin: true,
      organizations: [{ id: 'org-1', name: 'Test Org' }],
      defaultOrganizationId: 'org-1'
    });
  });

  it('navigates to group detail page when group is selected', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin/groups']}>
        <Routes>
          <Route path="/admin/groups" element={<GroupsAdminPage />} />
          <Route
            path="/admin/groups/:id"
            element={<div>Group Detail Route</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByText('Select Group'));

    await waitFor(() => {
      expect(screen.getByText('Group Detail Route')).toBeInTheDocument();
    });
  });

  it('renders GroupsAdmin component', async () => {
    render(
      <MemoryRouter>
        <GroupsAdminPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Groups Admin' })
      ).toBeInTheDocument();
    });
  });
});
