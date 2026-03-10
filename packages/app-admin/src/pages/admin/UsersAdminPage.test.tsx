import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminPage } from './UsersAdminPage';

const mockList = vi.fn();
const mockGetContext = vi.fn().mockResolvedValue({
  isRootAdmin: true,
  organizations: [{ id: 'org-1', name: 'Org 1' }]
});

vi.mock('@/lib/api', () => ({
  api: {
    adminV2: {
      getContext: () => mockGetContext(),
      users: {
        list: () => mockList()
      }
    }
  }
}));

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
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<UsersAdminPage />} />
          <Route path="/admin/users/:id" element={<div>User Detail Route</div>} />
          <Route
            path="/admin/users/ai-requests"
            element={<div>AI Requests Route</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    const userRow = await screen.findByText('admin@example.com');
    await user.click(userRow);

    await waitFor(() => {
      expect(screen.getByText('User Detail Route')).toBeInTheDocument();
    });
  });

  it('renders UsersAdmin component', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<UsersAdminPage />} />
          <Route path="/admin/users/:id" element={<div>User Detail Route</div>} />
          <Route
            path="/admin/users/ai-requests"
            element={<div>AI Requests Route</div>}
          />
        </Routes>
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
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<UsersAdminPage />} />
          <Route path="/admin/users/:id" element={<div>User Detail Route</div>} />
          <Route
            path="/admin/users/ai-requests"
            element={<div>AI Requests Route</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    const button = await screen.findByRole('button', { name: 'AI Requests' });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('AI Requests Route')).toBeInTheDocument();
    });
  });
});
