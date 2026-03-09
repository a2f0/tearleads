import { EmailWindow as EmailWindowBase } from '@tearleads/email';
import type { WindowDimensions } from '@tearleads/window-manager';
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
  const { isUnlocked: isDatabaseUnlocked } = useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

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
        isAuthenticated={isAuthenticated}
        isAuthLoading={isAuthLoading}
        lockedFallback={
          !isDatabaseUnlocked ? (
            <InlineUnlock description="email" />
          ) : !isAuthenticated ? (
            <InlineLogin description="email" />
          ) : null
        }
        openEmailId={openRequest?.emailId}
        openRequestId={openRequest?.requestId}
        {...(openRequest && { openComposeRequest: openRequest })}
      />
    </ClientEmailProvider>
  );
}
