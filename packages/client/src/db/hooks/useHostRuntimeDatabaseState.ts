import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { useMemo } from 'react';
import { useDatabaseContext } from './useDatabaseContext';

export function useHostRuntimeDatabaseState(): HostRuntimeDatabaseState {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  return useMemo(
    () => ({ isUnlocked, isLoading, currentInstanceId }),
    [isUnlocked, isLoading, currentInstanceId]
  );
}
