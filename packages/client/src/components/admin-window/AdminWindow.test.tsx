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

vi.mock('@/pages/admin/GroupsAdmin', () => ({
  GroupsAdmin: ({
    showBackLink,
    onGroupSelect
  }: {
    showBackLink?: boolean;
    onGroupSelect: (groupId: string) => void;
  }) => (
    <div data-testid="admin-groups-content">
      <span data-testid="groups-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button type="button" onClick={() => onGroupSelect('group-1')}>
        Select Group 1
      </button>
    </div>
  )
}));

vi.mock('@/pages/admin/UsersAdmin', () => ({
  UsersAdmin: ({
    showBackLink,
    onUserSelect
  }: {
    showBackLink?: boolean;
    onUserSelect: (userId: string) => void;
  }) => (
    <div data-testid="admin-users-content">
      <span data-testid="users-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button type="button" onClick={() => onUserSelect('user-1')}>
        Select User 1
      </button>
    </div>
  )
}));

vi.mock('@/pages/admin/GroupDetailPage', () => ({
  GroupDetailPage: ({
    groupId,
    backLink,
    onDelete
  }: {
    groupId: string;
    backLink: React.ReactNode;
    onDelete?: () => void;
  }) => (
    <div data-testid="group-detail-content">
      <span data-testid="group-id">{groupId}</span>
      <div data-testid="group-back-link">{backLink}</div>
      <button type="button" onClick={onDelete}>
        Delete Group
      </button>
    </div>
  )
}));

vi.mock('@/pages/admin/UsersAdminDetail', () => ({
  UsersAdminDetail: ({
    userId,
    backLink
  }: {
    userId: string;
    backLink: React.ReactNode;
  }) => (
    <div data-testid="user-detail-content">
      <span data-testid="user-id">{userId}</span>
      <div data-testid="user-back-link">{backLink}</div>
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

  it('renders the admin launcher with all options', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
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

  it('navigates to Groups view when Groups is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Groups'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Groups');
    expect(screen.getByTestId('admin-groups-content')).toBeInTheDocument();
    expect(screen.getByTestId('groups-backlink')).toHaveTextContent('false');
    expect(screen.getByText('Back to Admin')).toBeInTheDocument();
  });

  it('navigates to Users view when Users is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Users'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Users');
    expect(screen.getByTestId('admin-users-content')).toBeInTheDocument();
    expect(screen.getByTestId('users-backlink')).toHaveTextContent('false');
    expect(screen.getByText('Back to Admin')).toBeInTheDocument();
  });

  it('navigates to Group Detail view when a group is selected', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Groups'));
    await user.click(screen.getByText('Select Group 1'));

    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Group Detail'
    );
    expect(screen.getByTestId('group-detail-content')).toBeInTheDocument();
    expect(screen.getByTestId('group-id')).toHaveTextContent('group-1');
    // Check there's a back link in the group-back-link container
    expect(
      screen.getByTestId('group-back-link').querySelector('button')
    ).toBeInTheDocument();
  });

  it('navigates to User Detail view when a user is selected', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Users'));
    await user.click(screen.getByText('Select User 1'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('User');
    expect(screen.getByTestId('user-detail-content')).toBeInTheDocument();
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-1');
    // Check there's a back link in the user-back-link container
    expect(
      screen.getByTestId('user-back-link').querySelector('button')
    ).toBeInTheDocument();
  });

  it('returns to Groups view from Group Detail when back is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Groups'));
    await user.click(screen.getByText('Select Group 1'));
    expect(screen.getByTestId('group-detail-content')).toBeInTheDocument();

    const backButton = screen
      .getByTestId('group-back-link')
      .querySelector('button');
    if (!backButton) throw new Error('Back button not found');
    await user.click(backButton);

    expect(screen.getByTestId('window-title')).toHaveTextContent('Groups');
    expect(screen.getByTestId('admin-groups-content')).toBeInTheDocument();
  });

  it('returns to Users view from User Detail when back is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Users'));
    await user.click(screen.getByText('Select User 1'));
    expect(screen.getByTestId('user-detail-content')).toBeInTheDocument();

    const backButton = screen
      .getByTestId('user-back-link')
      .querySelector('button');
    if (!backButton) throw new Error('Back button not found');
    await user.click(backButton);

    expect(screen.getByTestId('window-title')).toHaveTextContent('Users');
    expect(screen.getByTestId('admin-users-content')).toBeInTheDocument();
  });

  it('returns to Groups view when group is deleted', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    await user.click(screen.getByText('Groups'));
    await user.click(screen.getByText('Select Group 1'));
    expect(screen.getByTestId('group-detail-content')).toBeInTheDocument();

    await user.click(screen.getByText('Delete Group'));

    expect(screen.getByTestId('window-title')).toHaveTextContent('Groups');
    expect(screen.getByTestId('admin-groups-content')).toBeInTheDocument();
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

  describe('initialView prop', () => {
    it('starts at Redis view when initialView is redis', () => {
      render(<AdminWindow {...defaultProps} initialView="redis" />);

      expect(screen.getByTestId('window-title')).toHaveTextContent('Redis');
      expect(screen.getByTestId('admin-redis-content')).toBeInTheDocument();
      expect(screen.getByText('Back to Admin')).toBeInTheDocument();
    });

    it('starts at Postgres view when initialView is postgres', () => {
      render(<AdminWindow {...defaultProps} initialView="postgres" />);

      expect(screen.getByTestId('window-title')).toHaveTextContent('Postgres');
      expect(screen.getByTestId('admin-postgres-content')).toBeInTheDocument();
      expect(screen.getByText('Back to Admin')).toBeInTheDocument();
    });

    it('starts at Groups view when initialView is groups', () => {
      render(<AdminWindow {...defaultProps} initialView="groups" />);

      expect(screen.getByTestId('window-title')).toHaveTextContent('Groups');
      expect(screen.getByTestId('admin-groups-content')).toBeInTheDocument();
      expect(screen.getByText('Back to Admin')).toBeInTheDocument();
    });

    it('starts at Users view when initialView is users', () => {
      render(<AdminWindow {...defaultProps} initialView="users" />);

      expect(screen.getByTestId('window-title')).toHaveTextContent('Users');
      expect(screen.getByTestId('admin-users-content')).toBeInTheDocument();
      expect(screen.getByText('Back to Admin')).toBeInTheDocument();
    });
  });
});
