import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminDetail } from './UsersAdminDetail';
import {
  buildUserResponse,
  user1,
  user1Response,
  user2,
  user2Response
} from './usersAdminDetailTestFixtures';

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

const renderWithRouter = (userId: string) => {
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
      <Routes>
        <Route path="/admin/users/:id" element={<UsersAdminDetail />} />
      </Routes>
    </MemoryRouter>
  );
};

const renderUser = async (userResponse: typeof user1Response) => {
  mockGet.mockResolvedValueOnce(userResponse);
  renderWithRouter(userResponse.user.id);
  await screen.findByRole('heading', { name: 'Edit User' });
};

describe('UsersAdminDetail (basic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupsList.mockResolvedValue({ groups: [] });
  });

  it('renders loading state initially', async () => {
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(user1Response), 100))
    );

    renderWithRouter('user-1');

    expect(screen.getByText('Loading user...')).toBeInTheDocument();
  });

  it('renders user details when loaded', async () => {
    await renderUser(user1Response);

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
    mockUpdate.mockResolvedValueOnce(
      buildUserResponse(user1, { email: 'new@example.com' })
    );

    await renderUser(user1Response);

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
    mockUpdate.mockResolvedValueOnce(
      buildUserResponse(user2, {
        organizationIds: ['org-1', 'org-2'],
        accounting: {
          totalPromptTokens: 10,
          totalCompletionTokens: 5,
          totalTokens: 15,
          requestCount: 1,
          lastUsedAt: '2024-02-15T08:15:00.000Z'
        }
      })
    );

    await renderUser(user2Response);

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
    mockUpdate.mockResolvedValueOnce(
      buildUserResponse(user2, { emailConfirmed: true })
    );

    await renderUser(user2Response);

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
    mockUpdate.mockResolvedValueOnce(buildUserResponse(user2, { admin: true }));

    await renderUser(user2Response);

    const adminCheckbox = screen.getByRole('checkbox', { name: 'Admin' });
    await user.click(adminCheckbox);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-2', { admin: true });
    });
  });

  it('shows error when save fails', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdate.mockRejectedValueOnce(new Error('Update failed'));

    await renderUser(user1Response);

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
    await renderUser(user1Response);

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'draft@example.com');

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
  });

  it('disables save button when email is empty', async () => {
    const user = userEvent.setup();
    await renderUser(user1Response);

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  it('navigates to filtered AI requests route from detail view', async () => {
    await renderUser(user1Response);

    await userEvent.click(
      screen.getByRole('button', { name: 'View Requests' })
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      '/admin/users/ai-requests?userId=user-1'
    );
  });

  it('calls onViewAiRequests callback when provided', async () => {
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

    await screen.findByRole('heading', { name: 'Edit User' });

    await userEvent.click(
      screen.getByRole('button', { name: 'View Requests' })
    );

    expect(onViewAiRequests).toHaveBeenCalledWith('user-1');
  });

  it('disables save button when no changes', async () => {
    await renderUser(user1Response);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  it('renders with custom backLink', async () => {
    mockGet.mockResolvedValueOnce(user1Response);

    render(
      <MemoryRouter initialEntries={['/admin/users/user-1']}>
        <Routes>
          <Route
            path="/admin/users/:id"
            element={
              <UsersAdminDetail backLink={<a href="/custom">Custom</a>} />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'Edit User' });

    expect(screen.getByRole('link', { name: 'Custom' })).toBeInTheDocument();
  });

  it('uses userId prop when provided', async () => {
    mockGet.mockResolvedValueOnce(user1Response);

    render(
      <MemoryRouter>
        <UsersAdminDetail userId="user-1" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('user-1');
    });
  });

  it('shows error when no userId provided', async () => {
    render(
      <MemoryRouter>
        <UsersAdminDetail userId="" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No user ID provided')).toBeInTheDocument();
    });
  });

  it('copies user id to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);

    await renderUser(user1Response);

    await user.click(
      screen.getByRole('button', { name: 'Copy user id to clipboard' })
    );

    expect(writeTextSpy).toHaveBeenCalledWith('user-1');
    writeTextSpy.mockRestore();
  });
});
