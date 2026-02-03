import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { GroupDetailPage } from '@/pages/admin/GroupDetailPage';
import { OrganizationDetailPage } from '@/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@/pages/admin/OrganizationsAdmin';
import { UsersAdminDetail } from '@/pages/admin/UsersAdminDetail';

type OrganizationsWindowView =
  | { type: 'index' }
  | { type: 'organization'; organizationId: string }
  | { type: 'user'; userId: string; organizationId: string }
  | { type: 'group'; groupId: string; organizationId: string };

interface AdminOrganizationsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminOrganizationsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminOrganizationsWindowProps) {
  const [view, setView] = useState<OrganizationsWindowView>({ type: 'index' });

  const title =
    view.type === 'index'
      ? 'Organizations Admin'
      : view.type === 'organization'
        ? 'Organization'
        : view.type === 'user'
          ? 'Edit User'
          : 'Edit Group';

  const handleOrganizationSelect = (organizationId: string) => {
    setView({ type: 'organization', organizationId });
  };

  const handleUserSelect = (userId: string) => {
    if (view.type !== 'organization') return;
    setView({ type: 'user', userId, organizationId: view.organizationId });
  };

  const handleGroupSelect = (groupId: string) => {
    if (view.type !== 'organization') return;
    setView({ type: 'group', groupId, organizationId: view.organizationId });
  };

  const handleBack = () => {
    setView({ type: 'index' });
  };

  const handleBackToOrganization = (organizationId: string) => {
    setView({ type: 'organization', organizationId });
  };

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={720}
      defaultHeight={600}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex h-full flex-col">
        <AdminWindowMenuBar onClose={onClose} />
        <div className="flex-1 overflow-auto p-3">
          {view.type === 'index' ? (
            <OrganizationsAdmin
              showBackLink={false}
              onOrganizationSelect={handleOrganizationSelect}
            />
          ) : view.type === 'organization' ? (
            <OrganizationDetailPage
              organizationId={view.organizationId}
              onDelete={handleBack}
              onUserSelect={handleUserSelect}
              onGroupSelect={handleGroupSelect}
              backLink={
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Organizations
                </button>
              }
            />
          ) : view.type === 'user' ? (
            <UsersAdminDetail
              userId={view.userId}
              backLink={
                <button
                  type="button"
                  onClick={() => handleBackToOrganization(view.organizationId)}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Organization
                </button>
              }
            />
          ) : (
            <GroupDetailPage
              groupId={view.groupId}
              onDelete={() => handleBackToOrganization(view.organizationId)}
              backLink={
                <button
                  type="button"
                  onClick={() => handleBackToOrganization(view.organizationId)}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Organization
                </button>
              }
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
