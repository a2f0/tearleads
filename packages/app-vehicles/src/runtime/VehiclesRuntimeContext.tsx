import type {
  HostRuntimeBaseProps,
  HostRuntimeDatabaseState
} from '@tearleads/shared';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { VehicleRepository } from '../lib/vehicleRepository.js';

export type VehiclesDatabaseState = HostRuntimeDatabaseState;

export interface VehiclesRuntimeContextValue {
  databaseState: VehiclesDatabaseState;
  repository: VehicleRepository | null;
}

const VehiclesRuntimeContext =
  createContext<VehiclesRuntimeContextValue | null>(null);

export interface VehiclesRuntimeProviderProps extends HostRuntimeBaseProps {
  children: ReactNode;
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
  const context = useContext(VehiclesRuntimeContext);
  if (!context) {
    throw new Error(
      'useVehiclesRuntime must be used within a VehiclesRuntimeProvider'
    );
  }
  return context;
}
