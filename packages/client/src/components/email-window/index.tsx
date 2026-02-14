import { EmailWindow as EmailWindowBase } from '@tearleads/email';
import type { WindowDimensions } from '@tearleads/window-manager';
import { useMemo } from 'react';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks';

interface EmailWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function EmailWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: EmailWindowProps) {
  const openRequest = useWindowOpenRequest('email');
  const { isUnlocked: isDatabaseUnlocked, isLoading: isDatabaseLoading } =
    useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  // Email requires both database unlock AND authentication
  // Show unlock first, then login (unlock is required to store auth tokens)
  const isFullyUnlocked = isDatabaseUnlocked && isAuthenticated;
  const isLoading = isDatabaseLoading || isAuthLoading;

  // Determine appropriate fallback based on which condition is not met
  const lockedFallback = useMemo(() => {
    if (!isDatabaseUnlocked) {
      return <InlineUnlock description="email" />;
    }
    if (!isAuthenticated) {
      return <InlineLogin description="email" />;
    }
    return null;
  }, [isDatabaseUnlocked, isAuthenticated]);

  return (
    <ClientEmailProvider>
      <EmailWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
        isUnlocked={isFullyUnlocked}
        isDatabaseLoading={isLoading}
        lockedFallback={lockedFallback}
        {...(openRequest && { openComposeRequest: openRequest })}
      />
    </ClientEmailProvider>
  );
}
