import {
  createHealthTracker,
  type HealthDatabaseState,
  HealthRuntimeProvider
} from '@tearleads/app-health/clientEntry';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext } from '@/db/hooks';

interface ClientHealthProviderProps {
  children: ReactNode;
}

export function ClientHealthProvider({ children }: ClientHealthProviderProps) {
  const { db, isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();

  const databaseState = useMemo<HealthDatabaseState>(
    () => ({
      isUnlocked,
      isLoading,
      currentInstanceId
    }),
    [isUnlocked, isLoading, currentInstanceId]
  );

  const createTracker = useCallback(() => {
    if (!db) {
      throw new Error('Health tracker requires an unlocked database');
    }

    return createHealthTracker(db);
  }, [db]);

  return (
    <HealthRuntimeProvider
      databaseState={databaseState}
      createTracker={createTracker}
      InlineUnlock={InlineUnlock}
    >
      {children}
    </HealthRuntimeProvider>
  );
}
