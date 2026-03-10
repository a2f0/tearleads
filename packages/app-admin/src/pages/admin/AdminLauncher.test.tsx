import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminLauncher } from './AdminLauncher';

const renderLauncher = () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AdminLauncher />} />
        <Route path="/admin/redis" element={<div>Redis Route</div>} />
        <Route path="/admin/postgres" element={<div>Postgres Route</div>} />
        <Route
          path="/admin/organizations"
          element={<div>Organizations Route</div>}
        />
        <Route path="/compliance" element={<div>Compliance Route</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('AdminLauncher', () => {
  it('renders admin launcher with Redis, Postgres, Organizations, and Compliance options', () => {
    renderLauncher();

    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
    expect(screen.getByText('Organizations')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
  });

  it('navigates to /admin/redis when Redis is clicked', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByText('Redis'));

    expect(screen.getByText('Redis Route')).toBeInTheDocument();
  });

  it('navigates to /admin/postgres when Postgres is clicked', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByText('Postgres'));

    expect(screen.getByText('Postgres Route')).toBeInTheDocument();
  });

  it('navigates to /admin/organizations when Organizations is clicked', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByText('Organizations'));

    expect(screen.getByText('Organizations Route')).toBeInTheDocument();
  });

  it('navigates to /compliance when Compliance is clicked', async () => {
    const user = userEvent.setup();
    renderLauncher();

    await user.click(screen.getByText('Compliance'));

    expect(screen.getByText('Compliance Route')).toBeInTheDocument();
  });
});
