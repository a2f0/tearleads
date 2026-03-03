// one-component-per-file: allow -- wrapper keeps inline lock/login fallback JSX selection local.
import type { WindowDimensions } from '@tearleads/window-manager';
import { useMemo } from 'react';
import { AdminPostgresWindow as AdminPostgresWindowBase } from '@/components/admin-windows';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';

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
  const { isUnlocked: isDatabaseUnlocked, isLoading: isDatabaseLoading } =
    useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const isFullyUnlocked = isDatabaseUnlocked && isAuthenticated;
  const isLoading = isDatabaseLoading || isAuthLoading;

  const lockedFallback = useMemo(() => {
    if (!isDatabaseUnlocked) {
      return <InlineUnlock description="Postgres Admin" />;
    }
    if (!isAuthenticated) {
      return <InlineLogin description="Postgres Admin" />;
    }
    return null;
  }, [isDatabaseUnlocked, isAuthenticated]);

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
      isUnlocked={isFullyUnlocked}
      isAuthLoading={isLoading}
      lockedFallback={lockedFallback}
    />
  );
}
