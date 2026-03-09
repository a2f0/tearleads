import {
  createVehicleRepository,
  type VehiclesDatabaseState,
  VehiclesRuntimeProvider
} from '@tearleads/vehicles';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useDatabaseContext } from '@/db/hooks';

interface ClientVehiclesProviderProps {
  children: ReactNode;
}

export function ClientVehiclesProvider({
  children
}: ClientVehiclesProviderProps) {
  const { db, isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();

  const databaseState = useMemo<VehiclesDatabaseState>(
    () => ({
      isUnlocked,
      isLoading,
      currentInstanceId
    }),
    [isUnlocked, isLoading, currentInstanceId]
  );

  const repository = useMemo(
    () => (db ? createVehicleRepository(db) : null),
    [db]
  );

  return (
    <VehiclesRuntimeProvider
      databaseState={databaseState}
      repository={repository}
    >
      {children}
    </VehiclesRuntimeProvider>
  );
}
