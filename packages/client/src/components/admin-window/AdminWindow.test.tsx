import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminWindow } from './AdminWindow';

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

vi.mock('@/pages/admin/Admin', () => ({
  Admin: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="admin-redis-content">
      <span data-testid="admin-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
    </div>
  )
}));

vi.mock('@/pages/admin/PostgresAdmin', () => ({
  PostgresAdmin: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="admin-postgres-content">
      <span data-testid="postgres-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
    </div>
  )
}));

describe('AdminWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Admin as title initially', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Admin');
  });

  it('renders the admin launcher with Redis and Postgres options', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
  });

  it('navigates to Redis view when Redis is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Redis'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Redis');
    expect(screen.getByTestId('admin-redis-content')).toBeInTheDocument();
    expect(screen.getByTestId('admin-backlink')).toHaveTextContent('false');
    expect(screen.getByText('Back to Admin')).toBeInTheDocument();
  });

  it('navigates to Postgres view when Postgres is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Postgres'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Postgres');
    expect(screen.getByTestId('admin-postgres-content')).toBeInTheDocument();
    expect(screen.getByTestId('postgres-backlink')).toHaveTextContent('false');
    expect(screen.getByText('Back to Admin')).toBeInTheDocument();
  });

  it('returns to index view when Back to Admin is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Redis'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Redis');

    await user.click(screen.getByText('Back to Admin'));
    expect(screen.getByTestId('window-title')).toHaveTextContent('Admin');
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 800,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <AdminWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
