import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationDetailPage } from './OrganizationDetailPage';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}));

const mockGet = vi.fn();
const mockGetUsers = vi.fn();
const mockGetGroups = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      organizations: {
        get: (id: string) => mockGet(id),
        getUsers: (id: string) => mockGetUsers(id),
        getGroups: (id: string) => mockGetGroups(id),
        update: (id: string, payload: unknown) => mockUpdate(id, payload),
        delete: (id: string) => mockDelete(id)
      }
    }
  }
}));

describe('OrganizationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const organizationResponse = {
    organization: {
      id: 'org-1',
      name: 'Acme',
      description: 'Team',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  };

  const usersResponse = {
    users: [
      {
        id: 'user-1',
        email: 'alice@example.com',
        joinedAt: '2024-01-01T00:00:00Z'
      }
    ]
  };

  const groupsResponse = {
    groups: [
      {
        id: 'group-1',
        name: 'Admins',
        description: 'Admin group',
        memberCount: 3
      }
    ]
  };

  const setupMocks = () => {
    mockGet.mockResolvedValue(organizationResponse);
    mockGetUsers.mockResolvedValue(usersResponse);
    mockGetGroups.mockResolvedValue(groupsResponse);
  };

  const renderWithRouter = (orgId: string) => {
    return render(
      <MemoryRouter initialEntries={[`/admin/organizations/${orgId}`]}>
        <Routes>
          <Route
            path="/admin/organizations/:id"
            element={<OrganizationDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders loading state initially', async () => {
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(organizationResponse), 100)
        )
    );
    mockGetUsers.mockImplementation(() => new Promise(() => {}));
    mockGetGroups.mockImplementation(() => new Promise(() => {}));

    renderWithRouter('org-1');

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders organization details in view mode', async () => {
    setupMocks();

    renderWithRouter('org-1');

    expect(
      await screen.findByRole('heading', { name: 'Acme' })
    ).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Users (1)')).toBeInTheDocument();
    expect(screen.getByText('Groups (1)')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Admins')).toBeInTheDocument();
  });

  it('copies organization id to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
      writeTextMock
    );
    setupMocks();

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByTestId('copy-organization-id'));

    expect(writeTextMock).toHaveBeenCalledWith('org-1');
  });

  it('enters edit mode when edit button is clicked', async () => {
    const user = userEvent.setup();
    setupMocks();

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByTestId('organization-edit-button'));

    expect(screen.getByTestId('organization-edit-name')).toBeInTheDocument();
    expect(
      screen.getByTestId('organization-edit-description')
    ).toBeInTheDocument();
  });

  it('cancels edit mode when cancel button is clicked', async () => {
    const user = userEvent.setup();
    setupMocks();

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });
    await user.click(screen.getByTestId('organization-edit-button'));

    expect(screen.getByTestId('organization-edit-name')).toBeInTheDocument();

    await user.click(screen.getByTestId('organization-cancel-button'));

    expect(
      screen.queryByTestId('organization-edit-name')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
  });

  it('updates organization and saves', async () => {
    const user = userEvent.setup();
    setupMocks();
    mockUpdate.mockResolvedValueOnce({
      organization: {
        id: 'org-1',
        name: 'Acme Updated',
        description: 'Team',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });
    await user.click(screen.getByTestId('organization-edit-button'));

    const nameInput = screen.getByTestId('organization-edit-name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Updated');

    await user.click(screen.getByTestId('organization-save-button'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('org-1', {
        name: 'Acme Updated',
        description: 'Team'
      });
    });
  });

  it('deletes organization when confirmed', async () => {
    const user = userEvent.setup();
    setupMocks();
    mockDelete.mockResolvedValueOnce({ deleted: true });

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });

    await user.click(screen.getByTestId('organization-delete-button'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('org-1');
    });
  });

  it('calls onUserSelect when user is clicked', async () => {
    const user = userEvent.setup();
    const onUserSelect = vi.fn();
    setupMocks();

    render(
      <MemoryRouter>
        <OrganizationDetailPage
          organizationId="org-1"
          onUserSelect={onUserSelect}
        />
      </MemoryRouter>
    );

    await screen.findByText('alice@example.com');
    await user.click(screen.getByTestId('organization-user-user-1'));

    expect(onUserSelect).toHaveBeenCalledWith('user-1');
  });

  it('calls onGroupSelect when group is clicked', async () => {
    const user = userEvent.setup();
    const onGroupSelect = vi.fn();
    setupMocks();

    render(
      <MemoryRouter>
        <OrganizationDetailPage
          organizationId="org-1"
          onGroupSelect={onGroupSelect}
        />
      </MemoryRouter>
    );

    await screen.findByText('Admins');
    await user.click(screen.getByTestId('organization-group-group-1'));

    expect(onGroupSelect).toHaveBeenCalledWith('group-1');
  });

  it('shows organization not found when fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    mockGetUsers.mockResolvedValue({ users: [] });
    mockGetGroups.mockResolvedValue({ groups: [] });

    renderWithRouter('org-1');

    await waitFor(() => {
      expect(screen.getByText('Organization not found')).toBeInTheDocument();
    });
  });

  it('shows organization not found when organization is null', async () => {
    mockGet.mockResolvedValue({ organization: null });
    mockGetUsers.mockResolvedValue({ users: [] });
    mockGetGroups.mockResolvedValue({ groups: [] });

    renderWithRouter('org-1');

    await waitFor(() => {
      expect(screen.getByText('Organization not found')).toBeInTheDocument();
    });
  });

  it('displays empty users and groups lists', async () => {
    mockGet.mockResolvedValue(organizationResponse);
    mockGetUsers.mockResolvedValue({ users: [] });
    mockGetGroups.mockResolvedValue({ groups: [] });

    renderWithRouter('org-1');

    await waitFor(() => {
      expect(
        screen.getByText('No users in this organization')
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('No groups in this organization')
    ).toBeInTheDocument();
  });

  it('shows conflict error when updating with duplicate name', async () => {
    const user = userEvent.setup();
    setupMocks();
    mockUpdate.mockRejectedValueOnce(new Error('409 Conflict'));

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });
    await user.click(screen.getByTestId('organization-edit-button'));

    const nameInput = screen.getByTestId('organization-edit-name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Existing Org');

    await user.click(screen.getByTestId('organization-save-button'));

    await waitFor(() => {
      expect(
        screen.getByText('An organization with this name already exists')
      ).toBeInTheDocument();
    });
  });

  it('updates description in edit mode', async () => {
    const user = userEvent.setup();
    setupMocks();
    mockUpdate.mockResolvedValueOnce({
      organization: {
        id: 'org-1',
        name: 'Acme',
        description: 'New description',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    renderWithRouter('org-1');

    await screen.findByRole('heading', { name: 'Acme' });
    await user.click(screen.getByTestId('organization-edit-button'));

    const descInput = screen.getByTestId('organization-edit-description');
    await user.clear(descInput);
    await user.type(descInput, 'New description');

    await user.click(screen.getByTestId('organization-save-button'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('org-1', {
        name: 'Acme',
        description: 'New description'
      });
    });
  });

  it('shows organization even when users/groups fetch fails', async () => {
    mockGet.mockResolvedValue(organizationResponse);
    mockGetUsers.mockRejectedValue(new Error('Users fetch failed'));
    mockGetGroups.mockRejectedValue(new Error('Groups fetch failed'));

    renderWithRouter('org-1');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    });
    expect(
      screen.getByText('No users in this organization')
    ).toBeInTheDocument();
    expect(
      screen.getByText('No groups in this organization')
    ).toBeInTheDocument();
  });
});
