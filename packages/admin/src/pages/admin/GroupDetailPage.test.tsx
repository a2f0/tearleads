import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupDetailPage } from './GroupDetailPage';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockAddMember = vi.fn();
const mockRemoveMember = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      groups: {
        get: (id: string) => mockGet(id),
        update: (id: string, data: unknown) => mockUpdate(id, data),
        delete: (id: string) => mockDelete(id),
        addMember: (id: string, userId: string) => mockAddMember(id, userId),
        removeMember: (id: string, userId: string) =>
          mockRemoveMember(id, userId)
      }
    }
  }
}));

describe('GroupDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderGroupDetailPage(groupId = 'group-1') {
    return render(
      <MemoryRouter initialEntries={[`/admin/groups/${groupId}`]}>
        <Routes>
          <Route path="/admin/groups/:id" element={<GroupDetailPage />} />
          <Route path="/admin/groups" element={<div>Groups list</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    renderGroupDetailPage();

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders group details after loading', async () => {
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: 'A test group',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: [
        {
          userId: 'user-1',
          email: 'user1@test.com',
          joinedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Edit Group' })
      ).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Test Group')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A test group')).toBeInTheDocument();
    expect(screen.getByText('user1@test.com')).toBeInTheDocument();
    expect(screen.getByText('Members (1)')).toBeInTheDocument();
  });

  it('renders not found state when group does not exist', async () => {
    mockGet.mockResolvedValue({ group: null, members: [] });

    renderGroupDetailPage('nonexistent');

    await waitFor(() => {
      expect(screen.getByText('Group not found')).toBeInTheDocument();
    });
  });

  it('updates group name and description', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: 'A test group',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockUpdate.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Updated Name',
        description: 'Updated description',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z'
      }
    });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Group')).toBeInTheDocument();
    });

    const nameInput = screen.getByDisplayValue('Test Group');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('group-1', {
        name: 'Updated Name',
        description: 'A test group'
      });
    });
  });

  it('shows error when update fails with duplicate name', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockUpdate.mockRejectedValue(new Error('409'));

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Group')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(
        screen.getByText('A group with this name already exists')
      ).toBeInTheDocument();
    });
  });

  it('adds a member to the group', async () => {
    const user = userEvent.setup();
    mockGet
      .mockResolvedValueOnce({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        members: []
      })
      .mockResolvedValueOnce({
        group: {
          id: 'group-1',
          organizationId: 'org-1',
          name: 'Test Group',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        members: [
          {
            userId: 'user-1',
            email: 'user1@test.com',
            joinedAt: '2024-01-01T00:00:00Z'
          }
        ]
      });
    mockAddMember.mockResolvedValue({ added: true });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Enter user ID');
    await user.type(input, 'user-1');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  it('shows no members message when group has no members', async () => {
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument();
    });
  });

  it('deletes group when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockDelete.mockResolvedValue({ deleted: true });

    render(
      <MemoryRouter initialEntries={['/admin/groups/group-1']}>
        <Routes>
          <Route
            path="/admin/groups/:id"
            element={<GroupDetailPage onDelete={onDelete} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Edit Group' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('group-delete-button'));

    expect(
      screen.getByText(
        'Are you sure you want to delete "Test Group"? This will remove all members from the group.'
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('group-1');
    });

    expect(onDelete).toHaveBeenCalled();
  });

  it('removes member when remove button is clicked', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: [
        {
          userId: 'user-1',
          email: 'user1@test.com',
          joinedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });
    mockRemoveMember.mockResolvedValue({ removed: true });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('user1@test.com')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('remove-member-user-1'));

    expect(screen.getByText('Remove Member')).toBeInTheDocument();
    expect(
      screen.getByText('Remove user1@test.com from this group?')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(mockRemoveMember).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  it('shows error when adding member fails with user not found', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockAddMember.mockRejectedValue(new Error('404'));

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Enter user ID');
    await user.type(input, 'nonexistent');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });
  });

  it('shows error when adding member fails with already a member', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockAddMember.mockRejectedValue(new Error('409'));

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Enter user ID');
    await user.type(input, 'existing-user');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(
        screen.getByText('User is already a member of this group')
      ).toBeInTheDocument();
    });
  });

  it('shows generic error when adding member fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockAddMember.mockRejectedValue(new Error('Server error'));

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Enter user ID');
    await user.type(input, 'user-1');
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('shows generic error when update fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });
    mockUpdate.mockRejectedValue(new Error('Server error'));

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Group')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('updates description field', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Test Group',
        description: 'Old description',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      },
      members: []
    });

    renderGroupDetailPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old description')).toBeInTheDocument();
    });

    const textarea = screen.getByDisplayValue('Old description');
    await user.clear(textarea);
    await user.type(textarea, 'New description');

    expect(screen.getByDisplayValue('New description')).toBeInTheDocument();
  });
});
