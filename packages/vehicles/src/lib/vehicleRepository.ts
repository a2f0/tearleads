import type { VehicleProfileInput } from './vehicleProfile.js';

export interface VehicleRecord {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleRepository {
  listVehicles: () => Promise<VehicleRecord[]>;
  createVehicle: (input: VehicleProfileInput) => Promise<VehicleRecord | null>;
  updateVehicle: (
    id: string,
    input: VehicleProfileInput
  ) => Promise<VehicleRecord | null>;
  deleteVehicle: (id: string) => Promise<boolean>;
}
