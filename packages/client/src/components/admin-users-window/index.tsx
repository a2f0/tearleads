import type { WindowDimensions } from '@tearleads/window-manager';
import { useMemo } from 'react';
import { AdminUsersWindow as AdminUsersWindowBase } from '@/components/admin-windows';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';
import { AdminUsersWindow as AdminUsersWindowBase } from '@/external/admin';

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
  const { isUnlocked: isDatabaseUnlocked, isLoading: isDatabaseLoading } =
    useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  // Users Admin requires both database unlock AND authentication
  // Show unlock first, then login (unlock is required to store auth tokens)
  const isFullyUnlocked = isDatabaseUnlocked && isAuthenticated;
  const isLoading = isDatabaseLoading || isAuthLoading;

  // Determine appropriate fallback based on which condition is not met
  const lockedFallback = useMemo(() => {
    if (!isDatabaseUnlocked) {
      return <InlineUnlock description="Users Admin" />;
    }
    if (!isAuthenticated) {
      return <InlineLogin description="Users Admin" />;
    }
    return null;
  }, [isDatabaseUnlocked, isAuthenticated]);

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
      isUnlocked={isFullyUnlocked}
      isAuthLoading={isLoading}
      lockedFallback={lockedFallback}
    />
  );
}
