import { describe, expect, it } from 'vitest';
import {
  formatVehicleDisplayName,
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
  normalizeVehicleProfile
} from './vehicle-profile.js';

describe('normalizeVehicleProfile', () => {
  it('normalizes valid input with trimming', () => {
    expect(
      normalizeVehicleProfile({
        make: '  Tesla ',
        model: ' Model Y  ',
        year: 2024,
        color: '  Midnight Silver  '
      })
    ).toEqual({
      ok: true,
      value: {
        make: 'Tesla',
        model: 'Model Y',
        year: 2024,
        color: 'Midnight Silver'
      }
    });
  });

  it('treats blank optional color as null', () => {
    expect(
      normalizeVehicleProfile({
        make: 'Honda',
        model: 'Civic',
        year: 2020,
        color: ' '
      })
    ).toEqual({
      ok: true,
      value: {
        make: 'Honda',
        model: 'Civic',
        year: 2020,
        color: null
      }
    });
  });

  it('allows year to be omitted', () => {
    expect(
      normalizeVehicleProfile({
        make: 'Ford',
        model: 'F-150',
        color: 'Blue'
      })
    ).toEqual({
      ok: true,
      value: {
        make: 'Ford',
        model: 'F-150',
        year: null,
        color: 'Blue'
      }
    });
  });

  it('returns required field errors for missing make/model', () => {
    expect(
      normalizeVehicleProfile({
        make: ' ',
        model: null
      })
    ).toEqual({
      ok: false,
      errors: [
        { field: 'make', error: 'Make is required' },
        { field: 'model', error: 'Model is required' }
      ]
    });
  });

  it('requires year to be an integer when provided', () => {
    expect(
      normalizeVehicleProfile({
        make: 'Toyota',
        model: 'Camry',
        year: 2024.5
      })
    ).toEqual({
      ok: false,
      errors: [{ field: 'year', error: 'Year must be a whole number' }]
    });
  });

  it('validates year range', () => {
    expect(
      normalizeVehicleProfile({
        make: 'Toyota',
        model: 'Camry',
        year: MIN_VEHICLE_YEAR - 1
      })
    ).toEqual({
      ok: false,
      errors: [
        {
          field: 'year',
          error: `Year must be between ${MIN_VEHICLE_YEAR} and ${MAX_VEHICLE_YEAR}`
        }
      ]
    });

    expect(
      normalizeVehicleProfile({
        make: 'Toyota',
        model: 'Camry',
        year: MAX_VEHICLE_YEAR + 1
      })
    ).toEqual({
      ok: false,
      errors: [
        {
          field: 'year',
          error: `Year must be between ${MIN_VEHICLE_YEAR} and ${MAX_VEHICLE_YEAR}`
        }
      ]
    });
  });
});

describe('formatVehicleDisplayName', () => {
  it('prefixes year when available', () => {
    expect(
      formatVehicleDisplayName({ make: 'Tesla', model: 'Model Y', year: 2024 })
    ).toBe('2024 Tesla Model Y');
  });

  it('omits year when null', () => {
    expect(
      formatVehicleDisplayName({ make: 'Tesla', model: 'Model Y', year: null })
    ).toBe('Tesla Model Y');
  });
});
