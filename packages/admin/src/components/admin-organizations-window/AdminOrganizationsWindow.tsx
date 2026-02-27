import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { GroupDetailPage } from '@admin/pages/admin/GroupDetailPage';
import { OrganizationDetailPage } from '@admin/pages/admin/OrganizationDetailPage';
import { OrganizationsAdmin } from '@admin/pages/admin/OrganizationsAdmin';
import { UsersAdminDetail } from '@admin/pages/admin/UsersAdminDetail';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTypedTranslation } from '@/i18n';

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
  /** Whether the user is authenticated and database is unlocked */
  isUnlocked?: boolean;
  /** Whether auth state is still loading */
  isAuthLoading?: boolean;
  /** Fallback UI to show when locked (e.g., login/unlock prompts) */
  lockedFallback?: ReactNode;
}

export function AdminOrganizationsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  isUnlocked = true,
  isAuthLoading = false,
  lockedFallback
}: AdminOrganizationsWindowProps) {
  const { t } = useTypedTranslation('admin');
  const [view, setView] = useState<OrganizationsWindowView>({ type: 'index' });

  const title = (() => {
    switch (view.type) {
      case 'index':
        return t('organizationsAdmin');
      case 'organization':
        return t('organizations');
      case 'user':
        return t('editUser');
      case 'group':
        return t('editGroup');
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

  const backControl = (() => {
    if (view.type === 'organization') {
      return {
        label: t('backToOrganizations'),
        onClick: handleBack,
        testId: 'admin-organizations-control-back-to-list'
      };
    }
    if (view.type === 'user' || view.type === 'group') {
      return {
        label: t('backToOrganization'),
        onClick: () => handleBackToOrganization(view.organizationId),
        testId: 'admin-organizations-control-back-to-organization'
      };
    }
    return null;
  })();

  const controls = backControl ? (
    <WindowControlGroup>
      <WindowControlButton
        icon={<ArrowLeft className="h-3 w-3" />}
        onClick={backControl.onClick}
        data-testid={backControl.testId}
      >
        {backControl.label}
      </WindowControlButton>
    </WindowControlGroup>
  ) : null;

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
        <AdminWindowMenuBar onClose={onClose} controls={controls} />
        <div className="flex-1 overflow-auto p-3">
          {isAuthLoading ? (
            <div
              className="flex h-full items-center justify-center text-muted-foreground"
              data-testid="admin-organizations-window-loading"
            >
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : !isUnlocked ? (
            <div
              className="flex h-full items-center justify-center p-4"
              data-testid="admin-organizations-window-locked"
            >
              {lockedFallback}
            </div>
          ) : view.type === 'index' ? (
            <OrganizationsAdmin
              showBackLink={false}
              onOrganizationSelect={handleOrganizationSelect}
            />
          ) : view.type === 'organization' ? (
            <OrganizationDetailPage
              organizationId={view.organizationId}
              onDelete={handleBack}
              backLink={false}
              onUserSelect={handleUserSelect}
              onGroupSelect={handleGroupSelect}
            />
          ) : view.type === 'user' ? (
            <UsersAdminDetail userId={view.userId} backLink={false} />
          ) : (
            <GroupDetailPage
              groupId={view.groupId}
              onDelete={() => handleBackToOrganization(view.organizationId)}
              backLink={false}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
