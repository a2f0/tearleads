import type { WindowDimensions } from '@tearleads/window-manager';
import { useMemo } from 'react';
import { AdminOrganizationsWindow as AdminOrganizationsWindowBase } from '@/components/admin-windows';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';

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
  const { isUnlocked: isDatabaseUnlocked, isLoading: isDatabaseLoading } =
    useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const isFullyUnlocked = isDatabaseUnlocked && isAuthenticated;
  const isLoading = isDatabaseLoading || isAuthLoading;

  const lockedFallback = useMemo(() => {
    if (!isDatabaseUnlocked) {
      return <InlineUnlock description="Organizations Admin" />;
    }
    if (!isAuthenticated) {
      return <InlineLogin description="Organizations Admin" />;
    }
    return null;
  }, [isDatabaseUnlocked, isAuthenticated]);

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
      isUnlocked={isFullyUnlocked}
      isAuthLoading={isLoading}
      lockedFallback={lockedFallback}
    />
  );
}
