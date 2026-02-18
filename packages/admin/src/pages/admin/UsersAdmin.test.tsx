import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdmin } from './UsersAdmin';

const mockList = vi.fn();
const mockUseAdminScope = vi.fn();
const mockSetSelectedOrganizationId = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      users: {
        list: () => mockList()
      }
    }
  }
}));

vi.mock('@admin/hooks/useAdminScope', () => ({
  useAdminScope: () => mockUseAdminScope()
}));

describe('UsersAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAdminScope.mockReturnValue({
      context: {
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org One' }],
        defaultOrganizationId: null
      },
      selectedOrganizationId: null,
      loading: false,
      error: null,
      setSelectedOrganizationId: mockSetSelectedOrganizationId
    });
  });

  const usersResponse = {
    users: [
      {
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
      },
      {
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
    ]
  };

  const defaultProps = {
    onUserSelect: vi.fn()
  };

  it('renders heading and user rows', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Users Admin' })
    ).toBeInTheDocument();
    expect(await screen.findByText('admin@example.com')).toBeVisible();
    expect(screen.getByText('regular@example.com')).toBeVisible();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Last Active')).toBeInTheDocument();
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows back link by default', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('back-link')).toBeInTheDocument();
  });

  it('hides back link when disabled', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} showBackLink={false} />
      </MemoryRouter>
    );

    await screen.findByText('admin@example.com');
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('calls onUserSelect callback when user row is clicked', async () => {
    const user = userEvent.setup();
    const onUserSelect = vi.fn();
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdmin onUserSelect={onUserSelect} />
      </MemoryRouter>
    );

    const userRow = await screen.findByText('admin@example.com');
    await user.click(userRow);

    expect(onUserSelect).toHaveBeenCalledWith('user-1');
  });

  it('shows loading state initially', async () => {
    mockList.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(usersResponse), 100))
    );

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading users...')).toBeInTheDocument();
  });

  it('shows error when fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockRejectedValueOnce(new Error('Failed to load'));

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('shows empty state when no users', async () => {
    mockList.mockResolvedValueOnce({ users: [] });

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No users found.')).toBeInTheDocument();
    });
  });

  it('displays user status icons correctly', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    await screen.findByText('admin@example.com');

    const yesLabels = screen.getAllByText('Yes');
    const noLabels = screen.getAllByText('No');

    expect(yesLabels.length).toBe(2);
    expect(noLabels.length).toBe(2);
  });

  it('refreshes users when refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(usersResponse);
    mockList.mockResolvedValueOnce({
      users: [
        {
          id: 'user-3',
          email: 'new@example.com',
          emailConfirmed: true,
          admin: false,
          organizationIds: ['org-2'],
          createdAt: '2024-03-01T09:00:00.000Z',
          lastActiveAt: '2024-03-05T12:30:00.000Z',
          accounting: {
            totalPromptTokens: 20,
            totalCompletionTokens: 10,
            totalTokens: 30,
            requestCount: 1,
            lastUsedAt: '2024-03-04T12:30:00.000Z'
          }
        }
      ]
    });

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} />
      </MemoryRouter>
    );

    await screen.findByText('admin@example.com');

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByText('new@example.com')).toBeInTheDocument();
    });
    expect(screen.queryByText('admin@example.com')).not.toBeInTheDocument();
  });

  it('shows AI Requests button when callback is provided', async () => {
    const user = userEvent.setup();
    const onViewAiRequests = vi.fn();
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdmin {...defaultProps} onViewAiRequests={onViewAiRequests} />
      </MemoryRouter>
    );

    const button = await screen.findByRole('button', { name: 'AI Requests' });
    await user.click(button);

    expect(onViewAiRequests).toHaveBeenCalledTimes(1);
  });
});
