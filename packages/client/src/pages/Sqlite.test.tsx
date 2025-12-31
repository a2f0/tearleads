import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sqlite } from './Sqlite';

// Mock the child components
vi.mock('@/components/sqlite/DatabaseTest', () => ({
  DatabaseTest: () => <div data-testid="database-test">DatabaseTest</div>
}));

vi.mock('@/components/sqlite/TableSizes', () => ({
  TableSizes: () => <div data-testid="table-sizes">TableSizes</div>
}));

describe('Sqlite', () => {
  it('renders the page title', () => {
    render(<Sqlite />);

    expect(screen.getByText('SQLite')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<Sqlite />);

    expect(
      screen.getByText(/Manage your encrypted SQLite database/)
    ).toBeInTheDocument();
  });

  it('renders the DatabaseTest component', () => {
    render(<Sqlite />);

    expect(screen.getByTestId('database-test')).toBeInTheDocument();
  });

  it('renders the TableSizes component', () => {
    render(<Sqlite />);

    expect(screen.getByTestId('table-sizes')).toBeInTheDocument();
  });
});
