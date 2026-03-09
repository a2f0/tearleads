export { createVehicleRepository } from './lib/createVehicleRepository.js';
export type {
  VehicleProfile,
  VehicleProfileInput,
  VehicleProfileValidationError,
  VehicleProfileValidationResult
} from './lib/vehicleProfile.js';
export {
  formatVehicleDisplayName,
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
  normalizeVehicleProfile
} from './lib/vehicleProfile.js';
export type {
  VehicleRecord,
  VehicleRepository
} from './lib/vehicleRepository.js';
export { VehiclesPage, type VehiclesPageProps } from './pages/index.js';
export {
  useVehiclesRuntime,
  type VehiclesDatabaseState,
  type VehiclesRuntimeContextValue,
  VehiclesRuntimeProvider,
  type VehiclesRuntimeProviderProps
} from './runtime/index.js';
