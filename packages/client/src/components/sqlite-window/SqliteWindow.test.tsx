import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteWindow } from './SqliteWindow';

// Mock FloatingWindow
vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    initialDimensions
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    initialDimensions?: { width: number; height: number; x: number; y: number };
  }) => (
    <div
      data-testid="floating-window"
      data-initial-dimensions={
        initialDimensions ? JSON.stringify(initialDimensions) : undefined
      }
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

// Mock DatabaseTest component with mount tracking
const databaseTestMount = vi.fn();
vi.mock('@/components/sqlite/DatabaseTest', () => ({
  DatabaseTest: () => {
    React.useEffect(() => {
      databaseTestMount();
    }, []);
    return <div data-testid="database-test-content">DatabaseTest Content</div>;
  }
}));

// Mock TableSizes component
vi.mock('@/components/sqlite/TableSizes', () => ({
  TableSizes: ({
    onTableSelect
  }: {
    onTableSelect?: (tableName: string) => void;
  }) => (
    <div data-testid="table-sizes-content">
      <button
        type="button"
        onClick={() => onTableSelect?.('users')}
        data-testid="table-sizes-select"
      >
        Users
      </button>
    </div>
  )
}));

vi.mock('@/components/sqlite/TableRowsView', () => ({
  TableRowsView: ({
    tableName,
    backLink
  }: {
    tableName: string | null;
    backLink?: React.ReactNode;
  }) => (
    <div data-testid="table-rows-view">
      <span data-testid="table-rows-name">{tableName}</span>
      {backLink}
    </div>
  )
}));

describe('SqliteWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<SqliteWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows SQLite as title', () => {
    render(<SqliteWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('SQLite');
  });

  it('renders the DatabaseTest content', () => {
    render(<SqliteWindow {...defaultProps} />);
    expect(screen.getByTestId('database-test-content')).toBeInTheDocument();
  });

  it('renders the TableSizes content', () => {
    render(<SqliteWindow {...defaultProps} />);
    expect(screen.getByTestId('table-sizes-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SqliteWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 600,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <SqliteWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<SqliteWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SqliteWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('has Refresh option in View menu', async () => {
    const user = userEvent.setup();
    render(<SqliteWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
  });

  it('triggers refresh when View > Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<SqliteWindow {...defaultProps} />);

    expect(databaseTestMount).toHaveBeenCalledTimes(1);

    // Click View menu and then Refresh
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    // The refresh remounts components with a new key, so mount should be called again
    expect(databaseTestMount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('database-test-content')).toBeInTheDocument();
    expect(screen.getByTestId('table-sizes-content')).toBeInTheDocument();
  });

  it('shows table rows in window when a table is selected', async () => {
    const user = userEvent.setup();
    render(<SqliteWindow {...defaultProps} />);

    await user.click(screen.getByTestId('table-sizes-select'));

    expect(screen.getByTestId('table-rows-view')).toBeInTheDocument();
    expect(screen.getByTestId('table-rows-name')).toHaveTextContent('users');
  });

  it('returns to table sizes when Back to SQLite is clicked', async () => {
    const user = userEvent.setup();
    render(<SqliteWindow {...defaultProps} />);

    await user.click(screen.getByTestId('table-sizes-select'));
    await user.click(screen.getByRole('button', { name: 'Back to SQLite' }));

    expect(screen.getByTestId('table-sizes-content')).toBeInTheDocument();
  });
});
