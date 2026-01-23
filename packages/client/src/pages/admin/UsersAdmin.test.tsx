import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersAdmin } from './UsersAdmin';

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

describe('UsersAdmin', () => {
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
      }
    ]
  };

  it('renders heading and user rows', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Users Admin' })
    ).toBeInTheDocument();
    expect(await screen.findByDisplayValue('admin@example.com')).toBeVisible();
  });

  it('shows back link by default', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('back-link')).toBeInTheDocument();
  });

  it('hides back link when disabled', async () => {
    mockList.mockResolvedValueOnce(usersResponse);
    render(
      <MemoryRouter>
        <UsersAdmin showBackLink={false} />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('admin@example.com');
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('updates a user when save is clicked', async () => {
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

    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

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
});
