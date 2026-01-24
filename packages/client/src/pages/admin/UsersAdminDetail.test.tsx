import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdminDetail } from './UsersAdminDetail';

const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      users: {
        list: () => mockList(),
        update: (id: string, payload: unknown) => mockUpdate(id, payload)
      }
    }
  }
}));

describe('UsersAdminDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const usersResponse = {
    users: [
      {
        id: 'user-1',
        email: 'admin@example.com',
        emailConfirmed: true,
        admin: true
      },
      {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: false,
        admin: false
      }
    ]
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
    mockList.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(usersResponse), 100))
    );

    renderWithRouter('user-1');

    expect(screen.getByText('Loading user...')).toBeInTheDocument();
  });

  it('renders user details when loaded', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    renderWithRouter('user-1');

    expect(
      await screen.findByRole('heading', { name: 'Edit User' })
    ).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
  });

  it('shows error when user not found', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    renderWithRouter('nonexistent');

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });
  });

  it('shows error when fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter('user-1');

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('updates email and saves', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(usersResponse);
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'new@example.com',
        emailConfirmed: true,
        admin: true
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

  it('toggles emailConfirmed checkbox and saves', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce({
      users: [
        {
          id: 'user-2',
          email: 'regular@example.com',
          emailConfirmed: false,
          admin: false
        }
      ]
    });
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: true,
        admin: false
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
    mockList.mockResolvedValueOnce({
      users: [
        {
          id: 'user-2',
          email: 'regular@example.com',
          emailConfirmed: false,
          admin: false
        }
      ]
    });
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-2',
        email: 'regular@example.com',
        emailConfirmed: false,
        admin: true
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
    mockList.mockResolvedValueOnce(usersResponse);
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
    mockList.mockResolvedValueOnce(usersResponse);

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
    mockList.mockResolvedValueOnce(usersResponse);

    renderWithRouter('user-1');

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
  });

  it('disables save button when no changes', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

    renderWithRouter('user-1');

    await screen.findByDisplayValue('admin@example.com');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  it('renders with custom backLink', async () => {
    mockList.mockResolvedValueOnce(usersResponse);

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
    mockList.mockResolvedValueOnce(usersResponse);

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
});
