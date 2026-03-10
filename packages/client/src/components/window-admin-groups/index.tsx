// one-component-per-file: allow -- wrapper keeps inline lock/login fallback JSX selection local.
import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminGroupsWindow as AdminGroupsWindowBase } from '@tearleads/app-admin/clientEntry';
import { useAdminWindowAuthGate } from '@/components/admin-windows/useAdminWindowAuthGate';

interface AdminGroupsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
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
  const { isUnlocked, isAuthLoading, lockedFallback } =
    useAdminWindowAuthGate('Groups Admin');

  return (
    <AdminGroupsWindowBase
      id={id}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      initialDimensions={initialDimensions}
      isUnlocked={isUnlocked}
      isAuthLoading={isAuthLoading}
      lockedFallback={lockedFallback}
    />
  );
}
