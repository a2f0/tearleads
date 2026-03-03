// one-component-per-file: allow -- hook intentionally builds inline fallback JSX for lock/login gating.
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { InlineLogin } from '@/components/auth/InlineLogin';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useAuth } from '@/contexts/AuthContext';
import { useDatabaseContext } from '@/db/hooks';

interface AdminWindowAuthGateState {
  isAuthLoading: boolean;
  isUnlocked: boolean;
  lockedFallback: ReactNode;
}

export function useAdminWindowAuthGate(
  description: string
): AdminWindowAuthGateState {
  const { isUnlocked: isDatabaseUnlocked, isLoading: isDatabaseLoading } =
    useDatabaseContext();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const isUnlocked = isDatabaseUnlocked && isAuthenticated;
  const isLoading = isDatabaseLoading || isAuthLoading;

  const lockedFallback = useMemo(() => {
    if (!isDatabaseUnlocked) {
      return <InlineUnlock description={description} />;
    }
    if (!isAuthenticated) {
      return <InlineLogin description={description} />;
    }
    return null;
  }, [description, isDatabaseUnlocked, isAuthenticated]);

  return {
    isAuthLoading: isLoading,
    isUnlocked,
    lockedFallback
  };
}
