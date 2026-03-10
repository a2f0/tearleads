import { AdminUsersWindow as AdminUsersWindowBase } from '@tearleads/app-admin/clientEntry';
import type { WindowDimensions } from '@tearleads/window-manager';
import { useAdminWindowAuthGate } from '@/components/admin-windows/useAdminWindowAuthGate';

interface AdminUsersWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
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
  const { isUnlocked, isAuthLoading, lockedFallback } =
    useAdminWindowAuthGate('Users Admin');

  return (
    <AdminUsersWindowBase
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
