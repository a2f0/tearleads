import type { VehicleRepository } from '@tearleads/vehicles';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle
} from '@/db/vehicles';

export const dbVehiclesRepository: VehicleRepository = {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle
};
