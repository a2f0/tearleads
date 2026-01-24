import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminUsersWindow } from './AdminUsersWindow';

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

vi.mock('@/pages/admin/UsersAdmin', () => ({
  UsersAdmin: ({
    showBackLink,
    onUserSelect
  }: {
    showBackLink?: boolean;
    onUserSelect?: (userId: string) => void;
  }) => (
    <div data-testid="users-admin-list">
      <span data-testid="admin-users-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button
        type="button"
        data-testid="select-user-btn"
        onClick={() => onUserSelect?.('user-123')}
      >
        Select User
      </button>
    </div>
  )
}));

vi.mock('@/pages/admin/UsersAdminDetail', () => ({
  UsersAdminDetail: ({
    userId,
    backLink
  }: {
    userId?: string | null;
    backLink?: React.ReactNode;
  }) => (
    <div data-testid="users-admin-detail">
      <span data-testid="detail-user-id">{userId}</span>
      {backLink}
    </div>
  )
}));

describe('AdminUsersWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminUsersWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Users Admin as title initially', () => {
    render(<AdminUsersWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Users Admin');
  });

  it('renders the users list initially', () => {
    render(<AdminUsersWindow {...defaultProps} />);
    expect(screen.getByTestId('users-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('admin-users-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('navigates to detail view when user is selected', async () => {
    const user = userEvent.setup();
    render(<AdminUsersWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-user-btn'));

    expect(screen.getByTestId('users-admin-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-user-id')).toHaveTextContent('user-123');
    expect(screen.getByTestId('window-title')).toHaveTextContent('Edit User');
  });

  it('navigates back to list when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminUsersWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-user-btn'));
    expect(screen.getByTestId('users-admin-detail')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to Users' }));

    expect(screen.getByTestId('users-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Users Admin');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminUsersWindow {...defaultProps} onClose={onClose} />);

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
      <AdminUsersWindow
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
    render(<AdminUsersWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminUsersWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
