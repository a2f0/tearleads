import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostgresTableRows } from './PostgresTableRows';

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({
    defaultTo,
    defaultLabel
  }: {
    defaultTo: string;
    defaultLabel: string;
  }) => <a href={defaultTo}>{defaultLabel}</a>
}));

vi.mock('@/components/admin-postgres/PostgresTableRowsView', () => ({
  PostgresTableRowsView: ({
    schema,
    tableName
  }: {
    schema: string | null;
    tableName: string | null;
  }) => (
    <div data-testid="postgres-table-rows-view">
      <span data-testid="schema">{schema ?? 'null'}</span>
      <span data-testid="table-name">{tableName ?? 'null'}</span>
    </div>
  )
}));

describe('PostgresTableRows', () => {
  it('renders PostgresTableRowsView component', () => {
    render(
      <MemoryRouter initialEntries={['/admin/postgres/public/users']}>
        <Routes>
          <Route
            path="/admin/postgres/:schema/:tableName"
            element={<PostgresTableRows />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('postgres-table-rows-view')).toBeInTheDocument();
  });

  it('passes schema param to PostgresTableRowsView', () => {
    render(
      <MemoryRouter initialEntries={['/admin/postgres/public/users']}>
        <Routes>
          <Route
            path="/admin/postgres/:schema/:tableName"
            element={<PostgresTableRows />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('schema')).toHaveTextContent('public');
  });

  it('passes tableName param to PostgresTableRowsView', () => {
    render(
      <MemoryRouter initialEntries={['/admin/postgres/public/users']}>
        <Routes>
          <Route
            path="/admin/postgres/:schema/:tableName"
            element={<PostgresTableRows />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('table-name')).toHaveTextContent('users');
  });

  it('handles missing params gracefully', () => {
    render(
      <MemoryRouter initialEntries={['/admin/postgres']}>
        <Routes>
          <Route path="/admin/postgres" element={<PostgresTableRows />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('schema')).toHaveTextContent('null');
    expect(screen.getByTestId('table-name')).toHaveTextContent('null');
  });
});
