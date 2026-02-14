import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { AiRequestsAdminPage } from '@admin/pages/admin/AiRequestsAdminPage';
import { UsersAdmin } from '@admin/pages/admin/UsersAdmin';
import { UsersAdminDetail } from '@admin/pages/admin/UsersAdminDetail';
import {
  DesktopFloatingWindow as FloatingWindow,
  type WindowDimensions,
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

type UsersWindowView =
  | { type: 'index' }
  | { type: 'user'; userId: string }
  | { type: 'ai-requests'; userId: string | null; from: 'index' | 'user' };

interface AdminUsersWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminUsersWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AdminUsersWindowProps) {
  const [view, setView] = useState<UsersWindowView>({ type: 'index' });

  const title =
    view.type === 'index'
      ? 'Users Admin'
      : view.type === 'ai-requests'
        ? 'AI Requests Admin'
        : 'Edit User';

  const handleUserSelect = (userId: string) => {
    setView({ type: 'user', userId });
  };

  const handleBack = () => {
    setView({ type: 'index' });
  };

  const handleAiRequestsBack = () => {
    if (view.type === 'ai-requests' && view.from === 'user' && view.userId) {
      setView({ type: 'user', userId: view.userId });
      return;
    }
    setView({ type: 'index' });
  };

  const backControl = (() => {
    if (view.type === 'ai-requests') {
      return {
        label: view.from === 'user' ? 'Back to User' : 'Back to Users',
        onClick: handleAiRequestsBack,
        testId: 'admin-users-control-back-ai-requests'
      };
    }
    if (view.type === 'user') {
      return {
        label: 'Back to Users',
        onClick: handleBack,
        testId: 'admin-users-control-back'
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
          {view.type === 'index' ? (
            <UsersAdmin
              showBackLink={false}
              onUserSelect={handleUserSelect}
              onViewAiRequests={() =>
                setView({ type: 'ai-requests', userId: null, from: 'index' })
              }
            />
          ) : view.type === 'ai-requests' ? (
            <AiRequestsAdminPage
              showBackLink={false}
              initialUserId={view.userId}
              backLink={false}
            />
          ) : (
            <UsersAdminDetail
              userId={view.userId}
              onViewAiRequests={(userId) =>
                setView({ type: 'ai-requests', userId, from: 'user' })
              }
              backLink={false}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
