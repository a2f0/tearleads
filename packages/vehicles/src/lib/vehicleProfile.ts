export const MIN_VEHICLE_YEAR = 1886;
export const MAX_VEHICLE_YEAR = 2100;

export interface VehicleProfileInput {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
}

export interface VehicleProfile {
  make: string;
  model: string;
  year: number | null;
  color: string | null;
}

type VehicleProfileField = 'make' | 'model' | 'year' | 'color';

export interface VehicleProfileValidationError {
  field: VehicleProfileField;
  error: string;
}

type VehicleProfileValidationSuccess = {
  ok: true;
  value: VehicleProfile;
};

type VehicleProfileValidationFailure = {
  ok: false;
  errors: VehicleProfileValidationError[];
};

export type VehicleProfileValidationResult =
  | VehicleProfileValidationSuccess
  | VehicleProfileValidationFailure;

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeVehicleProfile(
  input: VehicleProfileInput
): VehicleProfileValidationResult {
  const errors: VehicleProfileValidationError[] = [];

  const make = normalizeOptionalText(input.make);
  if (make === null) {
    errors.push({ field: 'make', error: 'Make is required' });
  }

  const model = normalizeOptionalText(input.model);
  if (model === null) {
    errors.push({ field: 'model', error: 'Model is required' });
  }

  let year: number | null = null;
  if (input.year !== null && input.year !== undefined) {
    if (!Number.isInteger(input.year)) {
      errors.push({ field: 'year', error: 'Year must be a whole number' });
    } else if (input.year < MIN_VEHICLE_YEAR || input.year > MAX_VEHICLE_YEAR) {
      errors.push({
        field: 'year',
        error: `Year must be between ${MIN_VEHICLE_YEAR} and ${MAX_VEHICLE_YEAR}`
      });
    } else {
      year = input.year;
    }
  }

  if (errors.length > 0 || make === null || model === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      make,
      model,
      year,
      color: normalizeOptionalText(input.color)
    }
  };
}

export function formatVehicleDisplayName(
  vehicle: Pick<VehicleProfile, 'make' | 'model' | 'year'>
): string {
  const descriptor = `${vehicle.make} ${vehicle.model}`.trim();
  return vehicle.year === null ? descriptor : `${vehicle.year} ${descriptor}`;
}
