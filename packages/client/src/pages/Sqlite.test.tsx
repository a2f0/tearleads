import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sqlite } from './Sqlite';

// Mock the child components
vi.mock('@/components/sqlite/DatabaseTest', () => ({
  DatabaseTest: () => <div data-testid="database-test">DatabaseTest Mock</div>
}));

vi.mock('@/components/sqlite/TableSizes', () => ({
  TableSizes: () => <div data-testid="table-sizes">TableSizes Mock</div>
}));

function renderSqlite() {
  return render(
    <MemoryRouter>
      <Sqlite />
    </MemoryRouter>
  );
}

describe('Sqlite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderSqlite();
  });

  describe('page rendering', () => {
    it('renders the page title', () => {
      expect(screen.getByText('SQLite')).toBeInTheDocument();
    });

    it('shows back link by default', () => {
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('renders the page description', () => {
      expect(
        screen.getByText(
          'Manage your encrypted SQLite database. Set up, unlock, lock, and reset your database here.'
        )
      ).toBeInTheDocument();
    });

    it('renders the DatabaseTest component', () => {
      expect(screen.getByTestId('database-test')).toBeInTheDocument();
    });

    it('renders the TableSizes component', () => {
      expect(screen.getByTestId('table-sizes')).toBeInTheDocument();
    });

    it('has correct heading level', () => {
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('SQLite');
    });
  });
});
