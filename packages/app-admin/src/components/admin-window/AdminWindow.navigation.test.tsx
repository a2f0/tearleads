import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminWindow } from './AdminWindow';

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

vi.mock('@admin/pages/admin/Admin', () => ({
  Admin: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="admin-redis-content">
      <span data-testid="admin-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
    </div>
  )
}));

vi.mock('@admin/pages/admin/PostgresAdmin', () => ({
  PostgresAdmin: ({
    showBackLink,
    onTableSelect
  }: {
    showBackLink?: boolean;
    onTableSelect?: (schema: string, tableName: string) => void;
  }) => (
    <div data-testid="admin-postgres-content">
      <span data-testid="postgres-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      {onTableSelect && (
        <button type="button" onClick={() => onTableSelect('public', 'users')}>
          Select Table
        </button>
      )}
    </div>
  )
}));

vi.mock('@admin/components/admin-postgres/PostgresTableRowsView', () => ({
  PostgresTableRowsView: ({
    schema,
    tableName,
    backLink
  }: {
    schema: string;
    tableName: string;
    backLink: React.ReactNode;
  }) => (
    <div data-testid="postgres-table-rows-content">
      <span data-testid="postgres-table-schema">{schema}</span>
      <span data-testid="postgres-table-name">{tableName}</span>
      <div data-testid="postgres-table-back-link">{backLink}</div>
    </div>
  )
}));

vi.mock('@admin/pages/admin/GroupsAdmin', () => ({
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

vi.mock('@admin/pages/admin/OrganizationsAdmin', () => ({
  OrganizationsAdmin: ({
    showBackLink,
    onOrganizationSelect
  }: {
    showBackLink?: boolean;
    onOrganizationSelect: (organizationId: string) => void;
  }) => (
    <div data-testid="admin-organizations-content">
      <span data-testid="organizations-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button type="button" onClick={() => onOrganizationSelect('org-1')}>
        Select Org 1
      </button>
    </div>
  )
}));

vi.mock('@admin/pages/admin/UsersAdmin', () => ({
  UsersAdmin: ({
    showBackLink,
    onUserSelect,
    onViewAiRequests
  }: {
    showBackLink?: boolean;
    onUserSelect: (userId: string) => void;
    onViewAiRequests?: () => void;
  }) => (
    <div data-testid="admin-users-content">
      <span data-testid="users-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
      <button type="button" onClick={() => onUserSelect('user-1')}>
        Select User 1
      </button>
      <button type="button" onClick={() => onViewAiRequests?.()}>
        View AI Requests
      </button>
    </div>
  )
}));

vi.mock('@admin/pages/admin/AiRequestsAdminPage', () => ({
  AiRequestsAdminPage: ({ backLink }: { backLink?: React.ReactNode }) => (
    <div data-testid="admin-ai-requests-content">
      <span>AI Requests</span>
      <div data-testid="admin-ai-requests-back-link">{backLink}</div>
    </div>
  )
}));

vi.mock('@admin/pages/admin/OrganizationDetailPage', () => ({
  OrganizationDetailPage: ({
    organizationId,
    backLink,
    onDelete
  }: {
    organizationId: string;
    backLink: React.ReactNode;
    onDelete?: () => void;
  }) => (
    <div data-testid="organization-detail-content">
      <span data-testid="organization-id">{organizationId}</span>
      <div data-testid="organization-back-link">{backLink}</div>
      <button type="button" onClick={onDelete}>
        Delete Organization
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

vi.mock('@admin/pages/admin/UsersAdminDetail', () => ({
  UsersAdminDetail: ({
    userId,
    backLink,
    onViewAiRequests
  }: {
    userId: string;
    backLink: React.ReactNode;
    onViewAiRequests?: (userId: string) => void;
  }) => (
    <div data-testid="user-detail-content">
      <span data-testid="user-id">{userId}</span>
      <button type="button" onClick={() => onViewAiRequests?.(userId)}>
        User Detail AI Requests
      </button>
      <div data-testid="user-back-link">{backLink}</div>
    </div>
  )
}));

vi.mock('./ComplianceIndex', () => ({
  ComplianceIndex: ({
    onFrameworkSelect
  }: {
    onFrameworkSelect: (frameworkId: string) => void;
  }) => (
    <div data-testid="compliance-index-content">
      <button type="button" onClick={() => onFrameworkSelect('SOC2')}>
        Select SOC2
      </button>
    </div>
  )
}));

vi.mock('./ComplianceDocView', () => ({
  ComplianceDocView: ({
    frameworkId,
    docPath,
    onDocSelect
  }: {
    frameworkId: string;
    docPath: string | null;
    onDocSelect: (docPath: string) => void;
  }) => (
    <div data-testid="compliance-doc-content">
      <span data-testid="compliance-framework-id">{frameworkId}</span>
      <span data-testid="compliance-doc-path">{docPath ?? 'null'}</span>
      <button type="button" onClick={() => onDocSelect('POLICY_INDEX.md')}>
        Select Policy Index
      </button>
    </div>
  )
}));

describe('AdminWindow navigation', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  describe('main view navigation', () => {
    it('navigates to Redis view when Redis is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Redis'));

      expect(screen.getByTestId('window-title')).toHaveTextContent('Redis');
      expect(screen.getByTestId('admin-redis-content')).toBeInTheDocument();
      expect(screen.getByTestId('admin-backlink')).toHaveTextContent('false');
      expect(
        screen.getByTestId('admin-window-control-back')
      ).toBeInTheDocument();
    });

    it('navigates to Postgres view when Postgres is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Postgres'));

      expect(screen.getByTestId('window-title')).toHaveTextContent('Postgres');
      expect(screen.getByTestId('admin-postgres-content')).toBeInTheDocument();
      expect(screen.getByTestId('postgres-backlink')).toHaveTextContent(
        'false'
      );
      expect(
        screen.getByTestId('admin-window-control-back')
      ).toBeInTheDocument();
    });

    it('navigates to Groups view when Groups is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Groups'));

      expect(screen.getByTestId('window-title')).toHaveTextContent('Groups');
      expect(screen.getByTestId('admin-groups-content')).toBeInTheDocument();
      expect(screen.getByTestId('groups-backlink')).toHaveTextContent('false');
      expect(
        screen.getByTestId('admin-window-control-back')
      ).toBeInTheDocument();
    });

    it('navigates to Users view when Users is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Users'));

      expect(screen.getByTestId('window-title')).toHaveTextContent('Users');
      expect(screen.getByTestId('admin-users-content')).toBeInTheDocument();
      expect(screen.getByTestId('users-backlink')).toHaveTextContent('false');
      expect(
        screen.getByTestId('admin-window-control-back')
      ).toBeInTheDocument();
    });

    it('navigates to Organizations view when Organizations is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Organizations'));

      expect(screen.getByTestId('window-title')).toHaveTextContent(
        'Organizations'
      );
      expect(
        screen.getByTestId('admin-organizations-content')
      ).toBeInTheDocument();
      expect(screen.getByTestId('organizations-backlink')).toHaveTextContent(
        'false'
      );
      expect(
        screen.getByTestId('admin-window-control-back')
      ).toBeInTheDocument();
    });

    it('returns to index view when control bar back is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Redis'));
      expect(screen.getByTestId('window-title')).toHaveTextContent('Redis');

      await user.click(screen.getByTestId('admin-window-control-back'));
      expect(screen.getByTestId('window-title')).toHaveTextContent('Admin');
      expect(screen.getByText('Redis')).toBeInTheDocument();
      expect(screen.getByText('Postgres')).toBeInTheDocument();
    });
  });

  describe('compliance navigation', () => {
    it('navigates to Compliance view when Compliance is clicked', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Compliance'));

      expect(screen.getByTestId('window-title')).toHaveTextContent(
        'Compliance'
      );
      expect(
        screen.getByTestId('compliance-index-content')
      ).toBeInTheDocument();
    });

    it('navigates to compliance doc view when framework is selected', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Compliance'));
      await user.click(screen.getByText('Select SOC2'));

      expect(screen.getByTestId('window-title')).toHaveTextContent('SOC 2');
      expect(screen.getByTestId('compliance-doc-content')).toBeInTheDocument();
      expect(screen.getByTestId('compliance-framework-id')).toHaveTextContent(
        'SOC2'
      );
    });

    it('returns to compliance index from compliance doc view via control bar', async () => {
      const user = userEvent.setup();
      render(<AdminWindow {...defaultProps} />);

      await user.click(screen.getByText('Compliance'));
      await user.click(screen.getByText('Select SOC2'));
      expect(screen.getByTestId('compliance-doc-content')).toBeInTheDocument();

      await user.click(screen.getByTestId('admin-window-control-back'));

      expect(screen.getByTestId('window-title')).toHaveTextContent(
        'Compliance'
      );
      expect(
        screen.getByTestId('compliance-index-content')
      ).toBeInTheDocument();
    });
  });
});
