import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminUsersWindow } from './AdminUsersWindow';

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();
  return {
    ...actual,
    DesktopFloatingWindow: ({
      children,
      title,
      onClose,
      initialDimensions
    }: {
      children: React.ReactNode;
      title: string;
      onClose: () => void;
      initialDimensions?: {
        width: number;
        height: number;
        x: number;
        y: number;
      };
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
  };
});

vi.mock('@admin/pages/admin/UsersAdmin', () => ({
  UsersAdmin: ({
    showBackLink,
    onUserSelect,
    onViewAiRequests
  }: {
    showBackLink?: boolean;
    onUserSelect?: (userId: string) => void;
    onViewAiRequests?: () => void;
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
      <button
        type="button"
        data-testid="view-ai-requests-btn"
        onClick={() => onViewAiRequests?.()}
      >
        View AI Requests
      </button>
    </div>
  )
}));

vi.mock('@admin/pages/admin/UsersAdminDetail', () => ({
  UsersAdminDetail: ({
    userId,
    backLink,
    onViewAiRequests
  }: {
    userId?: string | null;
    backLink?: React.ReactNode;
    onViewAiRequests?: (userId: string) => void;
  }) => (
    <div data-testid="users-admin-detail">
      <span data-testid="detail-user-id">{userId}</span>
      <button
        type="button"
        data-testid="detail-view-ai-requests-btn"
        onClick={() => onViewAiRequests?.(userId ?? 'unknown-user')}
      >
        Detail View AI Requests
      </button>
      {backLink}
    </div>
  )
}));

vi.mock('@admin/pages/admin/AiRequestsAdminPage', () => ({
  AiRequestsAdminPage: ({ backLink }: { backLink?: React.ReactNode }) => (
    <div data-testid="ai-requests-admin-page">
      <span>AI Requests Page</span>
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

  it('navigates to AI requests view and back to users list', async () => {
    const user = userEvent.setup();
    render(<AdminUsersWindow {...defaultProps} />);

    await user.click(screen.getByTestId('view-ai-requests-btn'));

    expect(screen.getByTestId('ai-requests-admin-page')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'AI Requests Admin'
    );

    await user.click(screen.getByRole('button', { name: 'Back to Users' }));

    expect(screen.getByTestId('users-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Users Admin');
  });

  it('navigates to AI requests from user detail and back to user detail', async () => {
    const user = userEvent.setup();
    render(<AdminUsersWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-user-btn'));
    await user.click(screen.getByTestId('detail-view-ai-requests-btn'));

    expect(screen.getByTestId('ai-requests-admin-page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to User' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back to User' }));
    expect(screen.getByTestId('users-admin-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-user-id')).toHaveTextContent('user-123');
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
    expect(screen.getByTestId('admin-window-controls')).toBeInTheDocument();
  });

  it('shows control-bar back action in user detail view', async () => {
    const user = userEvent.setup();
    render(<AdminUsersWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-user-btn'));

    expect(screen.getByTestId('admin-users-control-back')).toBeVisible();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminUsersWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  describe('auth state handling', () => {
    it('shows loading state when isAuthLoading is true', () => {
      render(<AdminUsersWindow {...defaultProps} isAuthLoading />);
      expect(
        screen.getByTestId('admin-users-window-loading')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('users-admin-list')).not.toBeInTheDocument();
    });

    it('shows lockedFallback when isUnlocked is false', () => {
      render(
        <AdminUsersWindow
          {...defaultProps}
          isUnlocked={false}
          lockedFallback={<div data-testid="mock-fallback">Please log in</div>}
        />
      );
      expect(
        screen.getByTestId('admin-users-window-locked')
      ).toBeInTheDocument();
      expect(screen.getByTestId('mock-fallback')).toBeInTheDocument();
      expect(screen.queryByTestId('users-admin-list')).not.toBeInTheDocument();
    });

    it('shows content when isUnlocked is true (default)', () => {
      render(<AdminUsersWindow {...defaultProps} />);
      expect(screen.getByTestId('users-admin-list')).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-users-window-loading')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-users-window-locked')
      ).not.toBeInTheDocument();
    });

    it('prioritizes loading state over locked state', () => {
      render(
        <AdminUsersWindow
          {...defaultProps}
          isAuthLoading
          isUnlocked={false}
          lockedFallback={<div data-testid="mock-fallback">Please log in</div>}
        />
      );
      expect(
        screen.getByTestId('admin-users-window-loading')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('mock-fallback')).not.toBeInTheDocument();
    });
  });
});
