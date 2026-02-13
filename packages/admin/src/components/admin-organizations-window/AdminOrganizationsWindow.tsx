import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { GroupDetailPage } from '@admin/pages/admin/GroupDetailPage';
import { OrganizationDetailPage } from '@admin/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@admin/pages/admin/OrganizationsAdmin';
import { UsersAdminDetail } from '@admin/pages/admin/UsersAdminDetail';

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
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminOrganizationsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AdminOrganizationsWindowProps) {
  const [view, setView] = useState<OrganizationsWindowView>({ type: 'index' });

  const title = (() => {
    switch (view.type) {
      case 'index':
        return 'Organizations Admin';
      case 'organization':
        return 'Organization';
      case 'user':
        return 'Edit User';
      case 'group':
        return 'Edit Group';
    }
  })();

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

  const renderBackToOrganizationButton = (organizationId: string) => (
    <button
      type="button"
      onClick={() => handleBackToOrganization(organizationId)}
      className="inline-flex items-center text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to Organization
    </button>
  );

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
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
              backLink={renderBackToOrganizationButton(view.organizationId)}
            />
          ) : (
            <GroupDetailPage
              groupId={view.groupId}
              onDelete={() => handleBackToOrganization(view.organizationId)}
              backLink={renderBackToOrganizationButton(view.organizationId)}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
