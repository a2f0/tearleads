import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOrganizationsWindow } from './AdminOrganizationsWindow';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

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

vi.mock('@/pages/admin/OrganizationsAdmin', () => ({
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

vi.mock('@/pages/admin/OrganizationDetailPage', () => ({
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
      {backLink}
      <button
        type="button"
        data-testid="select-user-btn"
        onClick={() => onUserSelect?.('user-456')}
      >
        Select User
      </button>
      <button
        type="button"
        data-testid="select-group-btn"
        onClick={() => onGroupSelect?.('group-789')}
      >
        Select Group
      </button>
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
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Organizations Admin as title initially', () => {
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organizations Admin'
    );
  });

  it('renders the organizations list initially', () => {
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('orgs-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('admin-orgs-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('navigates to detail view when organization is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );

    await user.click(screen.getByTestId('select-org-btn'));

    expect(screen.getByTestId('orgs-admin-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-org-id')).toHaveTextContent('org-123');
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Organization'
    );
  });

  it('navigates back to list when back button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );

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

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} onClose={onClose} />
      </MemoryRouter>
    );

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
      <MemoryRouter>
        <AdminOrganizationsWindow
          {...defaultProps}
          initialDimensions={initialDimensions}
        />
      </MemoryRouter>
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} onClose={onClose} />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to user detail when user is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );

    await user.click(screen.getByTestId('select-org-btn'));
    await user.click(screen.getByTestId('select-user-btn'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/user-456');
  });

  it('navigates to group detail when group is selected', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminOrganizationsWindow {...defaultProps} />
      </MemoryRouter>
    );

    await user.click(screen.getByTestId('select-org-btn'));
    await user.click(screen.getByTestId('select-group-btn'));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/groups/group-789');
  });
});
