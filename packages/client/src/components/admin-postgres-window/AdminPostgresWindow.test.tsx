import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminPostgresWindow } from './AdminPostgresWindow';

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

vi.mock('@/pages/admin/PostgresAdmin', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    PostgresAdmin: ({ showBackLink }: { showBackLink?: boolean }) => {
      const location = useLocation();
      return (
        <div data-testid="postgres-admin-content">
          <span data-testid="postgres-admin-location">{location.pathname}</span>
          <span data-testid="postgres-admin-backlink">
            {showBackLink ? 'true' : 'false'}
          </span>
        </div>
      );
    }
  };
});

describe('AdminPostgresWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminPostgresWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Postgres Admin as title', () => {
    render(<AdminPostgresWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Postgres Admin'
    );
  });

  it('renders the Postgres admin content', () => {
    render(<AdminPostgresWindow {...defaultProps} />);
    expect(screen.getByTestId('postgres-admin-location')).toHaveTextContent(
      '/admin/postgres'
    );
    expect(screen.getByTestId('postgres-admin-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminPostgresWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 760,
      height: 640,
      x: 100,
      y: 100
    };
    render(
      <AdminPostgresWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<AdminPostgresWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminPostgresWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('renders in compact mode without a Compact menu item', async () => {
    const user = userEvent.setup();
    render(<AdminPostgresWindow {...defaultProps} />);

    const contentContainer = screen.getByTestId(
      'postgres-admin-content'
    ).parentElement;
    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(contentContainer).toHaveClass('p-3');
    expect(
      screen.queryByRole('menuitem', { name: 'Compact' })
    ).not.toBeInTheDocument();
  });
});
