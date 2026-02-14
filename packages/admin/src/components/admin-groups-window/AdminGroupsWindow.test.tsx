import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminGroupsWindow } from './AdminGroupsWindow';

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
  };
});

vi.mock('@admin/pages/admin/GroupsAdmin', () => ({
  GroupsAdmin: ({
    showBackLink,
    onGroupSelect
  }: {
    showBackLink?: boolean;
    onGroupSelect?: (groupId: string) => void;
  }) => (
    <div data-testid="groups-admin-list">
      <span data-testid="admin-groups-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button
        type="button"
        data-testid="select-group-btn"
        onClick={() => onGroupSelect?.('group-123')}
      >
        Select Group
      </button>
    </div>
  )
}));

vi.mock('@admin/pages/admin/GroupDetailPage', () => ({
  GroupDetailPage: ({
    groupId,
    backLink,
    onDelete
  }: {
    groupId?: string | null;
    backLink?: React.ReactNode;
    onDelete?: () => void;
  }) => (
    <div data-testid="group-detail-page">
      <span data-testid="detail-group-id">{groupId}</span>
      {backLink}
      <button type="button" data-testid="delete-group" onClick={onDelete}>
        Delete
      </button>
    </div>
  )
}));

describe('AdminGroupsWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminGroupsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Groups Admin as title initially', () => {
    render(<AdminGroupsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Groups Admin'
    );
  });

  it('renders the groups list initially', () => {
    render(<AdminGroupsWindow {...defaultProps} />);
    expect(screen.getByTestId('groups-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('admin-groups-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('navigates to detail view when group is selected', async () => {
    const user = userEvent.setup();
    render(<AdminGroupsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-group-btn'));

    expect(screen.getByTestId('group-detail-page')).toBeInTheDocument();
    expect(screen.getByTestId('detail-group-id')).toHaveTextContent(
      'group-123'
    );
    expect(screen.getByTestId('window-title')).toHaveTextContent('Edit Group');
  });

  it('navigates back to list when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdminGroupsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-group-btn'));
    expect(screen.getByTestId('group-detail-page')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to Groups' }));

    expect(screen.getByTestId('groups-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Groups Admin'
    );
  });

  it('navigates back to list when group is deleted', async () => {
    const user = userEvent.setup();
    render(<AdminGroupsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-group-btn'));
    expect(screen.getByTestId('group-detail-page')).toBeInTheDocument();

    await user.click(screen.getByTestId('delete-group'));

    expect(screen.getByTestId('groups-admin-list')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Groups Admin'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminGroupsWindow {...defaultProps} onClose={onClose} />);

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
      <AdminGroupsWindow
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
    render(<AdminGroupsWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-controls')).toBeInTheDocument();
  });

  it('shows control-bar back action in group detail view', async () => {
    const user = userEvent.setup();
    render(<AdminGroupsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-group-btn'));

    expect(screen.getByTestId('admin-groups-control-back')).toBeVisible();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminGroupsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
