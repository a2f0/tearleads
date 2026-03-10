// one-component-per-file: allow -- wrapper keeps inline lock/login fallback JSX selection local.

import { AdminRedisWindow as AdminRedisWindowBase } from '@tearleads/app-admin/clientEntry';
import type { WindowDimensions } from '@tearleads/window-manager';
import { useAdminWindowAuthGate } from '@/components/admin-windows/useAdminWindowAuthGate';

interface AdminRedisWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminRedisWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AdminRedisWindowProps) {
  const { isUnlocked, isAuthLoading, lockedFallback } =
    useAdminWindowAuthGate('Redis Admin');

  return (
    <AdminRedisWindowBase
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
