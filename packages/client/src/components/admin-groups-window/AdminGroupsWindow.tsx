import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { AdminWindowMenuBar } from '@/components/admin-window/AdminWindowMenuBar';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { GroupDetailPage } from '@/pages/admin/GroupDetailPage';
import { GroupsAdmin } from '@/pages/admin/GroupsAdmin';

type GroupsWindowView = { type: 'index' } | { type: 'group'; groupId: string };

interface AdminGroupsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function AdminGroupsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AdminGroupsWindowProps) {
  const [view, setView] = useState<GroupsWindowView>({ type: 'index' });

  const title = view.type === 'index' ? 'Groups Admin' : 'Edit Group';

  const handleGroupSelect = (groupId: string) => {
    setView({ type: 'group', groupId });
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
            <GroupsAdmin
              showBackLink={false}
              onGroupSelect={handleGroupSelect}
            />
          ) : (
            <GroupDetailPage
              groupId={view.groupId}
              backLink={
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Groups
                </button>
              }
              onDelete={handleBack}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
