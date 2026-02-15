import type { AdminOptionId } from '@admin/components/admin';
import { AdminOptionsGrid } from '@admin/components/admin';
import { PostgresTableRowsView } from '@admin/components/admin-postgres/PostgresTableRowsView';
import { Admin } from '@admin/pages/admin/Admin';
import { AiRequestsAdminPage } from '@admin/pages/admin/AiRequestsAdminPage';
import { GroupDetailPage } from '@admin/pages/admin/GroupDetailPage';
import { GroupsAdmin } from '@admin/pages/admin/GroupsAdmin';
import { OrganizationDetailPage } from '@admin/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@admin/pages/admin/OrganizationsAdmin';
import { PostgresAdmin } from '@admin/pages/admin/PostgresAdmin';
import { UsersAdmin } from '@admin/pages/admin/UsersAdmin';
import { UsersAdminDetail } from '@admin/pages/admin/UsersAdminDetail';
import { getFrameworkLabel } from '@tearleads/compliance';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Shield } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';
import { ComplianceDocView } from './ComplianceDocView';
import { ComplianceIndex } from './ComplianceIndex';

type AdminView =
  | 'index'
  | Exclude<AdminOptionId, 'compliance'>
  | 'compliance'
  | { type: 'group-detail'; groupId: string }
  | { type: 'organization-detail'; organizationId: string }
  | { type: 'user-detail'; userId: string }
  | { type: 'ai-requests'; userId: string | null; from: 'users' | 'user' }
  | { type: 'postgres-table'; schema: string; tableName: string }
  | { type: 'compliance-doc'; frameworkId: string; docPath: string | null };

type AdminWindowInitialView = Exclude<AdminOptionId, 'compliance'>;

interface AdminWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
  initialView?: AdminWindowInitialView;
}

function getViewTitle(view: AdminView): string {
  if (view === 'index') return 'Admin';
  if (view === 'redis') return 'Redis';
  if (view === 'postgres') return 'Postgres';
  if (view === 'groups') return 'Groups';
  if (view === 'organizations') return 'Organizations';
  if (view === 'users') return 'Users';
  if (view === 'compliance') return 'Compliance';
  if (typeof view === 'object' && view.type === 'group-detail')
    return 'Group Detail';
  if (typeof view === 'object' && view.type === 'organization-detail')
    return 'Organization Detail';
  if (typeof view === 'object' && view.type === 'user-detail') return 'User';
  if (typeof view === 'object' && view.type === 'ai-requests')
    return 'AI Requests';
  if (typeof view === 'object' && view.type === 'postgres-table')
    return `${view.schema}.${view.tableName}`;
  if (typeof view === 'object' && view.type === 'compliance-doc')
    return getFrameworkLabel(view.frameworkId);
  return 'Admin';
}

function getBackTarget(view: AdminView): AdminView | null {
  if (view === 'index') return null;
  if (typeof view === 'string') return 'index';

  switch (view.type) {
    case 'group-detail':
      return 'groups';
    case 'organization-detail':
      return 'organizations';
    case 'user-detail':
      return 'users';
    case 'ai-requests':
      return view.from === 'user' && view.userId
        ? { type: 'user-detail', userId: view.userId }
        : 'users';
    case 'postgres-table':
      return 'postgres';
    case 'compliance-doc':
      return 'compliance';
  }
}

export function AdminWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  initialView
}: AdminWindowProps) {
  const [view, setView] = useState<AdminView>(initialView ?? 'index');
  const backTarget = getBackTarget(view);

  const handleGroupSelect = (groupId: string) => {
    setView({ type: 'group-detail', groupId });
  };

  const handleUserSelect = (userId: string) => {
    setView({ type: 'user-detail', userId });
  };

  const handleOrganizationSelect = (organizationId: string) => {
    setView({ type: 'organization-detail', organizationId });
  };

  const handleTableSelect = (schema: string, tableName: string) => {
    setView({ type: 'postgres-table', schema, tableName });
  };

  const renderContent = () => {
    if (view === 'index') {
      return (
        <div className="flex-1 space-y-6 overflow-auto">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Admin</h1>
          </div>
          <AdminOptionsGrid onSelect={setView} />
        </div>
      );
    }

    // Detail views handle their own back button
    if (typeof view === 'object' && view.type === 'group-detail') {
      return (
        <GroupDetailPage
          groupId={view.groupId}
          onDelete={() => setView('groups')}
          backLink={
            <button
              type="button"
              onClick={() => setView('groups')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          }
        />
      );
    }

    if (typeof view === 'object' && view.type === 'organization-detail') {
      return (
        <OrganizationDetailPage
          organizationId={view.organizationId}
          onDelete={() => setView('organizations')}
          backLink={
            <button
              type="button"
              onClick={() => setView('organizations')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          }
        />
      );
    }

    if (typeof view === 'object' && view.type === 'user-detail') {
      return (
        <UsersAdminDetail
          userId={view.userId}
          onViewAiRequests={(userId) =>
            setView({ type: 'ai-requests', userId, from: 'user' })
          }
          backLink={
            <button
              type="button"
              onClick={() => setView('users')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          }
        />
      );
    }

    if (typeof view === 'object' && view.type === 'ai-requests') {
      return (
        <AiRequestsAdminPage
          showBackLink={false}
          initialUserId={view.userId}
          backLink={
            <button
              type="button"
              onClick={() =>
                view.from === 'user' && view.userId
                  ? setView({ type: 'user-detail', userId: view.userId })
                  : setView('users')
              }
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          }
        />
      );
    }

    if (typeof view === 'object' && view.type === 'postgres-table') {
      return (
        <PostgresTableRowsView
          schema={view.schema}
          tableName={view.tableName}
          backLink={
            <button
              type="button"
              onClick={() => setView('postgres')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          }
        />
      );
    }

    if (typeof view === 'object' && view.type === 'compliance-doc') {
      return (
        <ComplianceDocView
          frameworkId={view.frameworkId}
          docPath={view.docPath}
          onDocSelect={(docPath) =>
            setView({
              type: 'compliance-doc',
              frameworkId: view.frameworkId,
              docPath
            })
          }
        />
      );
    }

    // List views get a back button wrapper
    let content: React.ReactNode;
    if (view === 'redis') {
      content = <Admin showBackLink={false} />;
    } else if (view === 'postgres') {
      content = (
        <PostgresAdmin showBackLink={false} onTableSelect={handleTableSelect} />
      );
    } else if (view === 'groups') {
      content = (
        <GroupsAdmin showBackLink={false} onGroupSelect={handleGroupSelect} />
      );
    } else if (view === 'organizations') {
      content = (
        <OrganizationsAdmin
          showBackLink={false}
          onOrganizationSelect={handleOrganizationSelect}
        />
      );
    } else if (view === 'users') {
      content = (
        <UsersAdmin
          showBackLink={false}
          onUserSelect={handleUserSelect}
          onViewAiRequests={() =>
            setView({ type: 'ai-requests', userId: null, from: 'users' })
          }
        />
      );
    } else if (view === 'compliance') {
      content = (
        <ComplianceIndex
          onFrameworkSelect={(frameworkId) =>
            setView({ type: 'compliance-doc', frameworkId, docPath: null })
          }
        />
      );
    }

    return content;
  };

  return (
    <FloatingWindow
      id={id}
      title={getViewTitle(view)}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
      contentClassName="overflow-hidden"
    >
      <div className="flex h-full flex-col overflow-hidden">
        <AdminWindowMenuBar onClose={onClose} />
        <WindowControlBar>
          <WindowControlGroup>
            {backTarget !== null && (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={() => setView(backTarget)}
                data-testid="admin-window-control-back"
              >
                Back
              </WindowControlButton>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {renderContent()}
        </div>
      </div>
    </FloatingWindow>
  );
}
