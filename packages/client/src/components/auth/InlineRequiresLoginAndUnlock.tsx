/**
 * Composite auth component that requires both database unlock AND user login.
 * Shows InlineUnlock first if database is locked, then InlineLogin if not authenticated.
 * Only renders children when both conditions are satisfied.
 */

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';
import { InlineLogin } from './InlineLogin';

interface InlineRequiresLoginAndUnlockProps {
  /** Content to render when both authenticated and unlocked */
  children: ReactNode;
  /** Description of what will be accessible (used for both prompts if specific ones not provided) */
  description?: string;
  /** Specific description for the login prompt */
  loginDescription?: string;
  /** Specific description for the unlock prompt */
  unlockDescription?: string;
}

export function InlineRequiresLoginAndUnlock({
  children,
  description = 'this feature',
  loginDescription,
  unlockDescription
}: InlineRequiresLoginAndUnlockProps) {
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  // Show loading state while either auth system is initializing
  if (isDatabaseLoading || isAuthLoading) {
    return (
      <div
        className="flex items-center justify-center p-8 text-muted-foreground"
        data-testid="inline-requires-login-and-unlock-loading"
      >
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading...
      </div>
    );
  }

  // Priority: unlock first, then login
  // This order makes sense because the database is needed to store auth tokens
  if (!isUnlocked) {
    return (
      <div
        className="flex h-full items-center justify-center p-4"
        data-testid="inline-requires-login-and-unlock-unlock"
      >
        <InlineUnlock description={unlockDescription ?? description} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="flex h-full items-center justify-center p-4"
        data-testid="inline-requires-login-and-unlock-login"
      >
        <InlineLogin description={loginDescription ?? description} />
      </div>
    );
  }

  return <>{children}</>;
}
