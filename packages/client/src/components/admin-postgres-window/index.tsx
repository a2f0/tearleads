// one-component-per-file: allow -- wrapper keeps inline lock/login fallback JSX selection local.
import type { WindowDimensions } from '@tearleads/window-manager';
import { AdminPostgresWindow as AdminPostgresWindowBase } from '@/components/admin-windows';
import { useAdminWindowAuthGate } from '@/components/admin-windows/useAdminWindowAuthGate';

interface AdminPostgresWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onRename?: (title: string) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function AdminPostgresWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: AdminPostgresWindowProps) {
  const { isUnlocked, isAuthLoading, lockedFallback } =
    useAdminWindowAuthGate('Postgres Admin');

  return (
    <AdminPostgresWindowBase
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
