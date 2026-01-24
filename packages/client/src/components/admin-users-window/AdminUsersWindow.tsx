import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { UsersAdmin } from '@/pages/admin/UsersAdmin';
import { UsersAdminDetail } from '@/pages/admin/UsersAdminDetail';

type UsersWindowView = { type: 'index' } | { type: 'user'; userId: string };

interface AdminUsersWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminUsersWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: AdminUsersWindowProps) {
  const [view, setView] = useState<UsersWindowView>({ type: 'index' });

  const title = view.type === 'index' ? 'Users Admin' : 'Edit User';

  const handleUserSelect = (userId: string) => {
    setView({ type: 'user', userId });
  };

  const handleBack = () => {
    setView({ type: 'index' });
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
            <UsersAdmin showBackLink={false} onUserSelect={handleUserSelect} />
          ) : (
            <UsersAdminDetail
              userId={view.userId}
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
