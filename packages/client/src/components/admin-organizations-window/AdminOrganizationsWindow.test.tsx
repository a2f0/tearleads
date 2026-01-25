import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminOrganizationsWindow } from './AdminOrganizationsWindow';

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
    backLink
  }: {
    organizationId?: string | null;
    backLink?: React.ReactNode;
  }) => (
    <div data-testid="orgs-admin-detail">
      <span data-testid="detail-org-id">{organizationId}</span>
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
      'Edit Organization'
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
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminOrganizationsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
