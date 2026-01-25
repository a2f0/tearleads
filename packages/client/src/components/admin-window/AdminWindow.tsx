import { ArrowLeft, Shield } from 'lucide-react';
import { useState } from 'react';
import type { AdminOptionId } from '@/components/admin';
import { AdminOptionsGrid } from '@/components/admin';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { Admin } from '@/pages/admin/Admin';
import { GroupDetailPage } from '@/pages/admin/GroupDetailPage';
import { GroupsAdmin } from '@/pages/admin/GroupsAdmin';
import { OrganizationDetailPage } from '@/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@/pages/admin/OrganizationsAdmin';
import { PostgresAdmin } from '@/pages/admin/PostgresAdmin';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';
import { UsersAdminDetail } from '@/pages/admin/UsersAdminDetail';
import { AdminWindowMenuBar } from './AdminWindowMenuBar';

type AdminView =
  | 'index'
  | AdminOptionId
  | { type: 'group-detail'; groupId: string }
  | { type: 'organization-detail'; organizationId: string }
  | { type: 'user-detail'; userId: string };

interface AdminWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
  initialView?: AdminOptionId;
}

function getViewTitle(view: AdminView): string {
  if (view === 'index') return 'Admin';
  if (view === 'redis') return 'Redis';
  if (view === 'postgres') return 'Postgres';
  if (view === 'groups') return 'Groups';
  if (view === 'organizations') return 'Organizations';
  if (view === 'users') return 'Users';
  if (typeof view === 'object' && view.type === 'group-detail')
    return 'Group Detail';
  if (typeof view === 'object' && view.type === 'organization-detail')
    return 'Organization Detail';
  if (typeof view === 'object' && view.type === 'user-detail') return 'User';
  return 'Admin';
}

export function AdminWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions,
  initialView
}: AdminWindowProps) {
  const [view, setView] = useState<AdminView>(initialView ?? 'index');

  const handleGroupSelect = (groupId: string) => {
    setView({ type: 'group-detail', groupId });
  };

  const handleUserSelect = (userId: string) => {
    setView({ type: 'user-detail', userId });
  };

  const handleOrganizationSelect = (organizationId: string) => {
    setView({ type: 'organization-detail', organizationId });
  };

  const renderContent = () => {
    if (view === 'index') {
      return (
        <div className="space-y-6">
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

    // List views get a back button wrapper
    let content: React.ReactNode;
    if (view === 'redis') {
      content = <Admin showBackLink={false} />;
    } else if (view === 'postgres') {
      content = <PostgresAdmin showBackLink={false} />;
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
        <UsersAdmin showBackLink={false} onUserSelect={handleUserSelect} />
      );
    }

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setView('index')}
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Admin
        </button>
        {content}
      </div>
    );
  };

  return (
    <FloatingWindow
      id={id}
      title={getViewTitle(view)}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">{renderContent()}</div>
      </div>
    </FloatingWindow>
  );
}
