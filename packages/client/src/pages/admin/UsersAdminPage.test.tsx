import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminPage } from './UsersAdminPage';

const mockList = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
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
  });

  const usersResponse = {
    users: [
      {
        id: 'user-1',
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true,
        organizationIds: ['org-1']
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
});
