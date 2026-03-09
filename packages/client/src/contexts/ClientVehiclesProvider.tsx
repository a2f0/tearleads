import {
  createVehicleRepository,
  VehiclesRuntimeProvider
} from '@tearleads/app-vehicles';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useDatabaseContext } from '@/db/hooks';
import { useHostRuntimeDatabaseState } from '@/db/hooks/useHostRuntimeDatabaseState';

interface ClientVehiclesProviderProps {
  children: ReactNode;
}

export function ClientVehiclesProvider({
  children
}: ClientVehiclesProviderProps) {
  const { db } = useDatabaseContext();
  const databaseState = useHostRuntimeDatabaseState();

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
