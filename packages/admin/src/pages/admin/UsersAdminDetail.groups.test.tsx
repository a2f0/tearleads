import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminDetail } from './UsersAdminDetail';
import { user1Response } from './usersAdminDetailTestFixtures';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockGroupsList = vi.fn();
const mockGetMembers = vi.fn();
const mockAddMember = vi.fn();
const mockRemoveMember = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      groups: {
        list: () => mockGroupsList(),
        getMembers: (id: string) => mockGetMembers(id),
        addMember: (groupId: string, userId: string) =>
          mockAddMember(groupId, userId),
        removeMember: (groupId: string, userId: string) =>
          mockRemoveMember(groupId, userId)
      },
      users: {
        get: (id: string) => mockGet(id),
        update: (id: string, payload: unknown) => mockUpdate(id, payload)
      }
    }
  }
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const renderUserDetail = async () => {
  mockGet.mockResolvedValueOnce(user1Response);
  render(
    <MemoryRouter initialEntries={['/admin/users/user-1']}>
      <Routes>
        <Route path="/admin/users/:id" element={<UsersAdminDetail />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Edit User' });
};

describe('UsersAdminDetail (groups)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group membership status and allows adding to a group', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockResolvedValueOnce({});

    await renderUserDetail();

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeInTheDocument();
    });
    expect(screen.getByText('Not a member')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to Group' }));

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  it('removes a user from a group via confirmation dialog', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({
      members: [
        {
          id: 'membership-1',
          groupId: 'group-1',
          userId: 'user-1',
          createdAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockRemoveMember.mockResolvedValueOnce({});

    await renderUserDetail();

    await waitFor(() => {
      expect(screen.getByText('Member')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Remove from Group' }));
    await waitFor(() => {
      expect(screen.getByText('Remove member from group?')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(mockRemoveMember).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  it('shows 409 conflict error when adding user already in group', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce({ status: 409 });

    await renderUserDetail();

    await user.click(screen.getByRole('button', { name: 'Add to Group' }));

    await waitFor(() => {
      expect(screen.getByText('User already in group')).toBeInTheDocument();
    });
  });

  it('shows 404 error when group or user not found', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce({ status: 404 });

    await renderUserDetail();

    await user.click(screen.getByRole('button', { name: 'Add to Group' }));

    await waitFor(() => {
      expect(screen.getByText('Group or user not found')).toBeInTheDocument();
    });
  });

  it('shows generic error message for other add member errors', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce(new Error('Boom'));

    await renderUserDetail();

    await user.click(screen.getByRole('button', { name: 'Add to Group' }));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to add user to group')
        ).toBeInTheDocument();
      });
  });

  it('shows error when remove member fails', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Team A',
          description: 'Team A description',
          organizationId: 'org-1',
          createdAt: '2024-03-01T00:00:00.000Z',
          updatedAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({
      members: [
        {
          id: 'membership-1',
          groupId: 'group-1',
          userId: 'user-1',
          createdAt: '2024-03-01T00:00:00.000Z'
        }
      ]
    });
    mockRemoveMember.mockRejectedValueOnce(new Error('Boom'));

    await renderUserDetail();

    await user.click(screen.getByRole('button', { name: 'Remove from Group' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to remove user from group')
        ).toBeInTheDocument();
      });
  });

  it('refreshes groups when refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockGroupsList.mockResolvedValue({ groups: [] });

    await renderUserDetail();

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(mockGroupsList).toHaveBeenCalledTimes(2);
    });
  });
});
