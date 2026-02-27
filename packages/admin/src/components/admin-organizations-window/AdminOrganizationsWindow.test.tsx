import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOrganizationsWindow } from './AdminOrganizationsWindow';

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

vi.mock('@admin/pages/admin/OrganizationsAdmin', () => ({
  OrganizationsAdmin: ({
    showBackLink,
    onOrganizationSelect
  }: {
    showBackLink?: boolean;
    onOrganizationSelect?: (organizationId: string) => void;
  }) => (
    <div data-testid="orgs-admin-list">
      <span data-testid="admin-orgs-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button
        type="button"
        data-testid="select-org-btn"
        onClick={() => onOrganizationSelect?.('org-123')}
      >
        Select Org
      </button>
    </div>
  )
}));

vi.mock('@admin/pages/admin/OrganizationDetailPage', () => ({
  OrganizationDetailPage: ({
    organizationId,
    backLink,
    onUserSelect,
    onGroupSelect
  }: {
    organizationId?: string | null;
    backLink?: React.ReactNode;
    onUserSelect?: (userId: string) => void;
    onGroupSelect?: (groupId: string) => void;
  }) => (
    <div data-testid="orgs-admin-detail">
      <span data-testid="detail-org-id">{organizationId}</span>
      <button
        type="button"
        data-testid="select-org-user"
        onClick={() => onUserSelect?.('user-123')}
      >
        Select User
      </button>
      <button
        type="button"
        data-testid="select-org-group"
        onClick={() => onGroupSelect?.('group-456')}
      >
        Select Group
      </button>
      {backLink}
    </div>
  )
}));

vi.mock('@admin/pages/admin/UsersAdminDetail', () => ({
  UsersAdminDetail: ({
    userId,
    backLink
  }: {
    userId?: string | null;
    backLink?: React.ReactNode;
  }) => (
    <div data-testid="orgs-admin-user-detail">
      <span data-testid="detail-user-id">{userId}</span>
      {backLink}
    </div>
  )
}));

vi.mock('@admin/pages/admin/GroupDetailPage', () => ({
  GroupDetailPage: ({
    groupId,
    backLink
  }: {
    groupId?: string | null;
    backLink?: React.ReactNode;
  }) => (
    <div data-testid="orgs-admin-group-detail">
      <span data-testid="detail-group-id">{groupId}</span>
      {backLink}
    </div>
  )
}));

describe('AdminOrganizationsWindow', () => {
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
    render(<AdminOrganizationsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Organizations Admin as title initially', () => {
    render(<AdminOrganizationsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organizations Admin'
    );
  });

  it('renders the organizations list initially', () => {
    render(<AdminOrganizationsWindow {...defaultProps} />);
    expect(screen.getByTestId('orgs-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('admin-orgs-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('navigates to detail view when organization is selected', async () => {
    const user = userEvent.setup();
    render(<AdminOrganizationsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-org-btn'));

    expect(screen.getByTestId('orgs-admin-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-org-id')).toHaveTextContent('org-123');
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organization'
    );
  });

  it('navigates back to list when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminOrganizationsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-org-btn'));
    expect(screen.getByTestId('orgs-admin-detail')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Back to Organizations' })
    );

    expect(screen.getByTestId('orgs-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organizations Admin'
    );
  });

  it.each([
    {
      view: 'user',
      selectButtonTestId: 'select-org-user',
      detailViewTestId: 'orgs-admin-user-detail',
      detailIdTestId: 'detail-user-id',
      expectedId: 'user-123',
      expectedTitle: 'Edit User'
    },
    {
      view: 'group',
      selectButtonTestId: 'select-org-group',
      detailViewTestId: 'orgs-admin-group-detail',
      detailIdTestId: 'detail-group-id',
      expectedId: 'group-456',
      expectedTitle: 'Edit Group'
    }
  ])('navigates to $view detail from organization view', async ({
    selectButtonTestId,
    detailViewTestId,
    detailIdTestId,
    expectedId,
    expectedTitle
  }) => {
    const user = userEvent.setup();
    render(<AdminOrganizationsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-org-btn'));
    await user.click(screen.getByTestId(selectButtonTestId));

    expect(screen.getByTestId(detailViewTestId)).toBeInTheDocument();
    expect(screen.getByTestId(detailIdTestId)).toHaveTextContent(expectedId);
    expect(screen.getByTestId('window-title')).toHaveTextContent(expectedTitle);

    await user.click(
      screen.getByRole('button', { name: 'Back to Organization' })
    );

    expect(screen.getByTestId('orgs-admin-detail')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organization'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminOrganizationsWindow {...defaultProps} onClose={onClose} />);

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
      <AdminOrganizationsWindow
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
    render(<AdminOrganizationsWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-controls')).toBeInTheDocument();
  });

  it('shows control-bar back action in organization detail view', async () => {
    const user = userEvent.setup();
    render(<AdminOrganizationsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-org-btn'));

    expect(
      screen.getByTestId('admin-organizations-control-back-to-list')
    ).toBeVisible();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminOrganizationsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  describe('auth gating', () => {
    it('shows loading spinner when isAuthLoading is true', () => {
      render(
        <AdminOrganizationsWindow {...defaultProps} isAuthLoading={true} />
      );
      expect(
        screen.getByTestId('admin-organizations-window-loading')
      ).toBeInTheDocument();
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByTestId('orgs-admin-list')).not.toBeInTheDocument();
    });

    it('shows locked fallback when isUnlocked is false', () => {
      render(
        <AdminOrganizationsWindow
          {...defaultProps}
          isUnlocked={false}
          lockedFallback={<div data-testid="locked-fallback">Sign in</div>}
        />
      );
      expect(
        screen.getByTestId('admin-organizations-window-locked')
      ).toBeInTheDocument();
      expect(screen.getByTestId('locked-fallback')).toBeInTheDocument();
      expect(screen.queryByTestId('orgs-admin-list')).not.toBeInTheDocument();
    });

    it('shows content when isUnlocked is true (default)', () => {
      render(<AdminOrganizationsWindow {...defaultProps} />);
      expect(screen.getByTestId('orgs-admin-list')).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-organizations-window-loading')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-organizations-window-locked')
      ).not.toBeInTheDocument();
    });

    it('prioritizes loading over locked state', () => {
      render(
        <AdminOrganizationsWindow
          {...defaultProps}
          isAuthLoading={true}
          isUnlocked={false}
          lockedFallback={<div data-testid="locked-fallback">Sign in</div>}
        />
      );
      expect(
        screen.getByTestId('admin-organizations-window-loading')
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-organizations-window-locked')
      ).not.toBeInTheDocument();
    });
  });
});
