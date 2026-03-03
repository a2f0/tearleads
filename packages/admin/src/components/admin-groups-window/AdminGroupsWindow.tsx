import { AdminWindowMenuBar } from '@admin/components/admin-window/AdminWindowMenuBar';
import { GroupDetailPage } from '@admin/pages/admin/GroupDetailPage';
import { GroupsAdmin } from '@admin/pages/admin/GroupsAdmin';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

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
  /** Whether the user is authenticated and database is unlocked */
  isUnlocked?: boolean;
  /** Whether auth state is still loading */
  isAuthLoading?: boolean;
  /** Fallback UI to show when locked (e.g., login/unlock prompts) */
  lockedFallback?: ReactNode;
}

export function AdminGroupsWindow({
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
        <AdminWindowMenuBar
          onClose={onClose}
          controls={controls}
          hideControlBar={!isUnlocked}
        />
        <div className="flex-1 overflow-auto p-3">
          {isAuthLoading ? (
            <div
              className="flex h-full items-center justify-center text-muted-foreground"
              data-testid="admin-groups-window-loading"
            >
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : !isUnlocked ? (
            <div
              className="flex h-full items-center justify-center p-4"
              data-testid="admin-groups-window-locked"
            >
              {lockedFallback}
            </div>
          ) : view.type === 'index' ? (
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
