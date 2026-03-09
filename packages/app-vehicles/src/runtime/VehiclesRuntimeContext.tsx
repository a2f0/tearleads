import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { VehicleRepository } from '../lib/vehicleRepository.js';

export type VehiclesDatabaseState = HostRuntimeDatabaseState;

export interface VehiclesRuntimeContextValue {
  databaseState: VehiclesDatabaseState;
  repository: VehicleRepository | null;
}

const FALLBACK_DATABASE_STATE: VehiclesDatabaseState = {
  isUnlocked: false,
  isLoading: false,
  currentInstanceId: null
};

const defaultContext: VehiclesRuntimeContextValue = {
  databaseState: FALLBACK_DATABASE_STATE,
  repository: null
};

const VehiclesRuntimeContext =
  createContext<VehiclesRuntimeContextValue>(defaultContext);

export interface VehiclesRuntimeProviderProps {
  children: ReactNode;
  databaseState: VehiclesDatabaseState;
  repository: VehicleRepository | null;
}

export function VehiclesRuntimeProvider({
  children,
  databaseState,
  repository
}: VehiclesRuntimeProviderProps) {
  const value = useMemo(
    () => ({
      databaseState,
      repository
    }),
    [databaseState, repository]
  );

  return (
    <VehiclesRuntimeContext.Provider value={value}>
      {children}
    </VehiclesRuntimeContext.Provider>
  );
}

export function useVehiclesRuntime(): VehiclesRuntimeContextValue {
  return useContext(VehiclesRuntimeContext);
}
