import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminPage } from './UsersAdminPage';

const mockList = vi.fn();
const mockGetContext = vi.fn().mockResolvedValue({
  isRootAdmin: true,
  organizations: [{ id: 'org-1', name: 'Org 1' }]
});
const mockNavigate = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: () => mockGetContext(),
      users: {
        list: () => mockList()
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

describe('UsersAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContext.mockResolvedValue({
      isRootAdmin: true,
      organizations: [{ id: 'org-1', name: 'Test Org' }],
      defaultOrganizationId: 'org-1'
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
      }
    ]
  };

  it('navigates to user detail page when user row is clicked', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdminPage />
      </MemoryRouter>
    );

    const userRow = await screen.findByText('admin@example.com');
    await user.click(userRow);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/users/user-1');
    });
  });

  it('renders UsersAdmin component', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdminPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Users Admin' })
    ).toBeInTheDocument();
    expect(await screen.findByText('admin@example.com')).toBeVisible();
  });

  it('navigates to AI requests page when AI Requests is clicked', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdminPage />
      </MemoryRouter>
    );

    const button = await screen.findByRole('button', { name: 'AI Requests' });
    await user.click(button);

    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/ai-requests');
  });
});
