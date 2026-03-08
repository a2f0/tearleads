import type { VehicleProfileInput } from '@tearleads/vehicles';
export type { VehicleRecord } from '@tearleads/vehicles/vehiclesDb';
import {
  createVehicle as createVehicleWithAdapter,
  deleteVehicle as deleteVehicleWithAdapter,
  getVehicleById as getVehicleByIdWithAdapter,
  listVehicles as listVehiclesWithAdapter,
  updateVehicle as updateVehicleWithAdapter
} from '@tearleads/vehicles/vehiclesDb';
import { getDatabaseAdapter, isDatabaseInitialized } from './state';

export async function getVehicleById(id: string) {
  if (!isDatabaseInitialized()) {
    return null;
  }
  return getVehicleByIdWithAdapter(getDatabaseAdapter(), id);
}

export async function listVehicles() {
  if (!isDatabaseInitialized()) {
    return [];
  }
  return listVehiclesWithAdapter(getDatabaseAdapter());
}

export async function createVehicle(input: VehicleProfileInput) {
  if (!isDatabaseInitialized()) {
    return null;
  }
  return createVehicleWithAdapter(getDatabaseAdapter(), input);
}

export async function updateVehicle(id: string, input: VehicleProfileInput) {
  if (!isDatabaseInitialized()) {
    return null;
  }
  return updateVehicleWithAdapter(getDatabaseAdapter(), id, input);
}

export async function deleteVehicle(id: string) {
  if (!isDatabaseInitialized()) {
    return false;
  }
  return deleteVehicleWithAdapter(getDatabaseAdapter(), id);
}
