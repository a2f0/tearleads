import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostgresAdmin } from './PostgresAdmin';

vi.mock('@/components/admin-postgres/PostgresConnectionPanel', () => ({
  PostgresConnectionPanel: () => <div data-testid="postgres-connection-panel" />
}));

vi.mock('@/components/admin-postgres/PostgresTableSizes', () => ({
  PostgresTableSizes: () => <div data-testid="postgres-table-sizes" />
}));

describe('PostgresAdmin', () => {
  it('renders the heading and admin panels', () => {
    render(
      <MemoryRouter>
        <PostgresAdmin />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Postgres Admin' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('postgres-connection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('postgres-table-sizes')).toBeInTheDocument();
  });
});
