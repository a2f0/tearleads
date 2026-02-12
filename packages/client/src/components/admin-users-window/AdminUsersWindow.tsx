import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { AiRequestsAdminPage } from '@/pages/admin/AiRequestsAdminPage';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';
import { UsersAdminDetail } from '@/pages/admin/UsersAdminDetail';

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
              backLink={
                <button
                  type="button"
                  onClick={handleAiRequestsBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {view.from === 'user' ? 'Back to User' : 'Back to Users'}
                </button>
              }
            />
          ) : (
            <UsersAdminDetail
              userId={view.userId}
              onViewAiRequests={(userId) =>
                setView({ type: 'ai-requests', userId, from: 'user' })
              }
              backLink={
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Users
                </button>
              }
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
