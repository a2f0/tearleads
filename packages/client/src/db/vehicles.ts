export type { VehicleRecord } from '@tearleads/vehicles/vehiclesDb';

import {
  createVehicle as createVehicleWithAdapter,
  deleteVehicle as deleteVehicleWithAdapter,
  getVehicleById as getVehicleByIdWithAdapter,
  listVehicles as listVehiclesWithAdapter,
  updateVehicle as updateVehicleWithAdapter
} from '@tearleads/vehicles/vehiclesDb';
import { getDatabaseAdapter, isDatabaseInitialized } from './state';

type ActiveDatabaseAdapter = ReturnType<typeof getDatabaseAdapter>;

function withDatabase<TResult, TArgs extends unknown[]>(
  operation: (
    adapter: ActiveDatabaseAdapter,
    ...args: TArgs
  ) => Promise<TResult>,
  uninitializedResult: TResult
) {
  return async (...args: TArgs): Promise<TResult> => {
    if (!isDatabaseInitialized()) {
      return uninitializedResult;
    }

    return operation(getDatabaseAdapter(), ...args);
  };
}

const emptyVehicles: Awaited<ReturnType<typeof listVehiclesWithAdapter>> = [];

export const getVehicleById = withDatabase(getVehicleByIdWithAdapter, null);
export const listVehicles = withDatabase(
  listVehiclesWithAdapter,
  emptyVehicles
);
export const createVehicle = withDatabase(createVehicleWithAdapter, null);
export const updateVehicle = withDatabase(updateVehicleWithAdapter, null);
export const deleteVehicle = withDatabase(deleteVehicleWithAdapter, false);
