import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminOrganizationsWindow as AdminOrganizationsWindowBase } from '@tearleads/app-admin/clientEntry';
import { useAdminWindowAuthGate } from '@/components/admin-windows/useAdminWindowAuthGate';

interface AdminOrganizationsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
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
  const { isUnlocked, isAuthLoading, lockedFallback } = useAdminWindowAuthGate(
    'Organizations Admin'
  );

  return (
    <AdminOrganizationsWindowBase
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
