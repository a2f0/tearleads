import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { GroupDetailPage } from '@admin/pages/admin/GroupDetailPage';
import { GroupsAdmin } from '@admin/pages/admin/GroupsAdmin';
import {
  WindowControlButton,
  WindowControlGroup
} from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';

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

  const controls =
    view.type === 'group' ? (
      <WindowControlGroup>
        <WindowControlButton
          icon={<ArrowLeft className="h-3 w-3" />}
          onClick={handleBack}
          data-testid="admin-groups-control-back"
        >
          Back to Groups
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
            <GroupsAdmin
              showBackLink={false}
              onGroupSelect={handleGroupSelect}
            />
          ) : (
            <GroupDetailPage
              groupId={view.groupId}
              backLink={false}
              onDelete={handleBack}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
