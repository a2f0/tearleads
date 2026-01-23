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

  it('shows error when update fails', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockResolvedValueOnce(usersResponse);
    mockUpdate.mockRejectedValueOnce(new Error('Update failed'));

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
      expect(screen.getByText('Update failed')).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('toggles emailConfirmed checkbox', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce({
      users: [
        {
          id: 'user-1',
          email: 'test@example.com',
          emailConfirmed: false,
          admin: false
        }
      ]
    });
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        emailConfirmed: true,
        admin: false
      }
    });

    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('test@example.com');
    const checkboxes = screen.getAllByRole('checkbox');
    const emailConfirmedCheckbox = checkboxes[0];
    if (emailConfirmedCheckbox) {
      await user.click(emailConfirmedCheckbox);
    }

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-1', {
        emailConfirmed: true
      });
    });
  });

  it('toggles admin checkbox', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce({
      users: [
        {
          id: 'user-1',
          email: 'test@example.com',
          emailConfirmed: true,
          admin: false
        }
      ]
    });
    mockUpdate.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        emailConfirmed: true,
        admin: true
      }
    });

    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

    await screen.findByDisplayValue('test@example.com');
    const checkboxes = screen.getAllByRole('checkbox');
    const adminCheckbox = checkboxes[1];
    if (adminCheckbox) {
      await user.click(adminCheckbox);
    }

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('user-1', {
        admin: true
      });
    });
  });

  it('resets draft when Reset button is clicked', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce(usersResponse);

    render(
      <MemoryRouter>
        <UsersAdmin />
      </MemoryRouter>
    );

    const emailInput = await screen.findByDisplayValue('admin@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'changed@example.com');

    expect(screen.getByDisplayValue('changed@example.com')).toBeInTheDocument();

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    await user.click(resetButton);

    expect(screen.getByDisplayValue('admin@example.com')).toBeInTheDocument();
  });
});
