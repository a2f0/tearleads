import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminDetail } from './UsersAdminDetail';

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

describe('UsersAdminDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupsList.mockResolvedValue({ groups: [] });
  });

  const user1Response = {
    user: {
      id: 'user-1',
      email: 'admin@example.com',
      emailConfirmed: true,
      admin: true,
      organizationIds: ['org-1'],
      createdAt: '2024-01-01T12:00:00.000Z',
      lastActiveAt: '2024-01-10T18:30:00.000Z',
      accounting: {
        totalPromptTokens: 120,
        totalCompletionTokens: 80,
        totalTokens: 200,
        requestCount: 3,
        lastUsedAt: '2024-01-09T12:00:00.000Z'
      }
    }
  };

  const user2Response = {
    user: {
      id: 'user-2',
      email: 'regular@example.com',
      emailConfirmed: false,
      admin: false,
      organizationIds: [],
      createdAt: '2024-02-14T08:15:00.000Z',
      lastActiveAt: null,
      accounting: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        lastUsedAt: null
      }
    }
  };

  const renderWithRouter = (userId: string) => {
    return render(
      <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
        <Routes>
          <Route path="/admin/users/:id" element={<UsersAdminDetail />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders loading state initially', async () => {
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(user1Response), 100))
    );

    renderWithRouter('user-1');

    expect(screen.getByText('Loading user...')).toBeInTheDocument();
  });

  it('renders user details when loaded', async () => {
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    expect(
      await screen.findByRole('heading', { name: 'Edit User' })
    ).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization IDs')).toHaveValue('org-1');
    expect(screen.getByText('AI Usage')).toBeInTheDocument();
  });

  it('shows error when user not found', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce(new Error('API error: 404'));

    renderWithRouter('nonexistent');

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('shows error when fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter('user-1');

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('updates email and saves', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'new@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1'],
        createdAt: '2024-01-01T12:00:00.000Z',
        lastActiveAt: '2024-01-10T18:30:00.000Z',
        accounting: {
          totalPromptTokens: 120,
          totalCompletionTokens: 80,
          totalTokens: 200,
          requestCount: 3,
          lastUsedAt: '2024-01-09T12:00:00.000Z'
        }
      }
    });

    renderWithRouter('user-1');

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'new@example.com');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-1', {
        email: 'new@example.com'
      });
    });
  });

  it('updates organization IDs and saves', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user2Response);
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: false,
        admin: false,
        organizationIds: ['org-1', 'org-2'],
        createdAt: '2024-02-14T08:15:00.000Z',
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 10,
          totalCompletionTokens: 5,
          totalTokens: 15,
          requestCount: 1,
          lastUsedAt: '2024-02-15T08:15:00.000Z'
        }
      }
    });

    renderWithRouter('user-2');

    const orgInput = await screen.findByLabelText('Organization IDs');
    await user.clear(orgInput);
    await user.type(orgInput, 'org-1, org-2');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-2', {
        organizationIds: ['org-1', 'org-2']
      });
    });
  });

  it('toggles emailConfirmed checkbox and saves', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user2Response);
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: true,
        admin: false,
        organizationIds: [],
        createdAt: '2024-02-14T08:15:00.000Z',
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });

    renderWithRouter('user-2');

    await screen.findByDisplayValue('regular@example.com');
    const emailConfirmedCheckbox = screen.getByRole('checkbox', {
      name: 'Email Confirmed'
    });
    await user.click(emailConfirmedCheckbox);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-2', {
        emailConfirmed: true
      });
    });
  });

  it('toggles admin checkbox and saves', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user2Response);
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: false,
        admin: true,
        organizationIds: [],
        createdAt: '2024-02-14T08:15:00.000Z',
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });

    renderWithRouter('user-2');

    await screen.findByDisplayValue('regular@example.com');
    const adminCheckbox = screen.getByRole('checkbox', { name: 'Admin' });
    await user.click(adminCheckbox);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-2', {
        admin: true
      });
    });
  });

  it('shows error when save fails', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockResolvedValueOnce(user1Response);
    mockUpdate.mockRejectedValueOnce(new Error('Update failed'));

    renderWithRouter('user-1');

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'new@example.com');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Update failed')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('resets draft when Reset button is clicked', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'changed@example.com');

    expect(screen.getByDisplayValue('changed@example.com')).toBeInTheDocument();

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    await user.click(resetButton);

    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
  });

  it('disables save button when email is empty', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
  });

  it('navigates to filtered AI requests route from detail view', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    await screen.findByDisplayValue('admin@example.com');
    await user.click(screen.getByRole('button', { name: 'View Requests' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      '/admin/users/ai-requests?userId=user-1'
    );
  });

  it('calls onViewAiRequests callback when provided', async () => {
    const user = userEvent.setup();
    const onViewAiRequests = vi.fn();
    mockGet.mockResolvedValueOnce(user1Response);

    render(
      <MemoryRouter initialEntries={['/admin/users/user-1']}>
        <Routes>
          <Route
            path="/admin/users/:id"
            element={<UsersAdminDetail onViewAiRequests={onViewAiRequests} />}
          />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByDisplayValue('admin@example.com');
    await user.click(screen.getByRole('button', { name: 'View Requests' }));

    expect(onViewAiRequests).toHaveBeenCalledWith('user-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('disables save button when no changes', async () => {
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    await screen.findByDisplayValue('admin@example.com');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  it('renders with custom backLink', async () => {
    mockGet.mockResolvedValueOnce(user1Response);

    render(
      <MemoryRouter>
        <UsersAdminDetail
          userId="user-1"
          backLink={<button type="button">Custom Back</button>}
        />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('admin@example.com');
    expect(
      screen.getByRole('button', { name: 'Custom Back' })
    ).toBeInTheDocument();
  });

  it('uses userId prop when provided', async () => {
    mockGet.mockResolvedValueOnce(user2Response);

    render(
      <MemoryRouter>
        <UsersAdminDetail userId="user-2" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByDisplayValue('regular@example.com')
      ).toBeInTheDocument();
    });
  });

  it('shows error when no userId provided', async () => {
    render(
      <MemoryRouter>
        <UsersAdminDetail />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No user ID provided')).toBeInTheDocument();
    });
  });

  it('copies user id to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
      writeTextMock
    );
    mockGet.mockResolvedValueOnce(user1Response);

    renderWithRouter('user-1');

    await screen.findByText('user-1');
    await user.click(screen.getByTestId('copy-user-id'));

    expect(writeTextMock).toHaveBeenCalledWith('user-1');
  });

  it('renders group membership status and allows adding to a group', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Alpha',
          description: 'Primary',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 1
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockResolvedValueOnce({ added: true });

    renderWithRouter('user-1');

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Not a member')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add' });
    await user.click(addButton);

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  it('removes a user from a group via confirmation dialog', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-2',
          name: 'Beta',
          description: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 2
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({
      members: [
        {
          userId: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2024-01-02T00:00:00.000Z'
        }
      ]
    });
    mockRemoveMember.mockResolvedValueOnce({ removed: true });

    renderWithRouter('user-1');

    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/^Member/)).toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: 'Remove' });
    await user.click(removeButton);

    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(mockRemoveMember).toHaveBeenCalledWith('group-2', 'user-1');
    });
  });

  it('shows 409 conflict error when adding user already in group', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Alpha',
          description: 'Primary',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 1
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce(new Error('409 conflict'));

    renderWithRouter('user-1');

    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add' });
    await user.click(addButton);

    await waitFor(() => {
      expect(
        screen.getByText('User is already a member of this group')
      ).toBeInTheDocument();
    });
  });

  it('shows 404 error when group or user not found', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Alpha',
          description: 'Primary',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 1
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce(new Error('404 not found'));

    renderWithRouter('user-1');

    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add' });
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('Group or user not found')).toBeInTheDocument();
    });
  });

  it('shows generic error message for other add member errors', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-1',
          name: 'Alpha',
          description: 'Primary',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 1
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({ members: [] });
    mockAddMember.mockRejectedValueOnce(new Error('Server error'));

    renderWithRouter('user-1');

    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add' });
    await user.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('shows error when remove member fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValueOnce({
      groups: [
        {
          id: 'group-2',
          name: 'Beta',
          description: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 2
        }
      ]
    });
    mockGetMembers.mockResolvedValueOnce({
      members: [
        {
          userId: 'user-1',
          email: 'admin@example.com',
          joinedAt: '2024-01-02T00:00:00.000Z'
        }
      ]
    });
    mockRemoveMember.mockRejectedValueOnce(new Error('Remove failed'));

    renderWithRouter('user-1');

    expect(await screen.findByText('Beta')).toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: 'Remove' });
    await user.click(removeButton);

    await user.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => {
      expect(screen.getByText('Remove failed')).toBeInTheDocument();
    });
  });

  it('refreshes groups when refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(user1Response);
    mockGroupsList.mockResolvedValue({
      groups: [
        {
          id: 'group-1',
          name: 'Alpha',
          description: 'Primary',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          memberCount: 1
        }
      ]
    });
    mockGetMembers.mockResolvedValue({ members: [] });

    renderWithRouter('user-1');

    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    // Clear mock call counts
    mockGroupsList.mockClear();
    mockGetMembers.mockClear();

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(mockGroupsList).toHaveBeenCalled();
    });
  });
});
