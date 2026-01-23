import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLauncher } from './AdminLauncher';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('AdminLauncher', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders admin launcher with Redis and Postgres options', () => {
    render(
      <MemoryRouter>
        <AdminLauncher />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
  });

  it('navigates to /admin/redis when Redis is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminLauncher />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Redis'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/redis');
  });

  it('navigates to /admin/postgres when Postgres is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminLauncher />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Postgres'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/postgres');
  });
});
