import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostgresAdmin } from './PostgresAdmin';

vi.mock('@admin/components/admin-postgres/PostgresConnectionPanel', () => ({
  PostgresConnectionPanel: () => <div data-testid="postgres-connection-panel" />
}));

vi.mock('@admin/components/admin-postgres/PostgresTableSizes', () => ({
  PostgresTableSizes: () => <div data-testid="postgres-table-sizes" />
}));

describe('PostgresAdmin', () => {
  function renderPostgresAdmin(showBackLink = true) {
    return render(
      <MemoryRouter>
        <PostgresAdmin showBackLink={showBackLink} />
      </MemoryRouter>
    );
  }

  it('renders the heading and admin panels', () => {
    renderPostgresAdmin();

    expect(
      screen.getByRole('heading', { name: 'Postgres Admin' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('postgres-connection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('postgres-table-sizes')).toBeInTheDocument();
  });

  it('shows back link by default', () => {
    renderPostgresAdmin();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('hides back link when disabled', () => {
    renderPostgresAdmin(false);
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('renders with fallback router when none is provided', () => {
    render(<PostgresAdmin />);
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });
});
