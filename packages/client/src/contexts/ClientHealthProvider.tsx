import {
  createHealthTracker,
  HealthRuntimeProvider
} from '@tearleads/app-health/clientEntry';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useDatabaseContext, useHostRuntimeDatabaseState } from '@/db/hooks';

interface ClientHealthProviderProps {
  children: ReactNode;
}

export function ClientHealthProvider({ children }: ClientHealthProviderProps) {
  const { db } = useDatabaseContext();
  const databaseState = useHostRuntimeDatabaseState();

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
