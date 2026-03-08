import type { DatabaseAdapter } from '@tearleads/db/adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockAdapter: DatabaseAdapter = {
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute: mockExecute,
  executeMany: vi.fn(async () => {}),
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
};

import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  listVehicles,
  updateVehicle
} from './vehiclesDb';

describe('vehicles db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps rows from listVehicles query', async () => {
    const now = Date.now();
    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          id: 'vehicle-1',
          make: 'Tesla',
          model: 'Model Y',
          year: 2024,
          color: 'Blue',
          createdAt: now,
          updatedAt: now
        }
      ]
    });

    const vehicles = await listVehicles(mockAdapter);

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toEqual({
      id: 'vehicle-1',
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      color: 'Blue',
      createdAt: new Date(now),
      updatedAt: new Date(now)
    });
  });

  it('returns null from createVehicle when validation fails', async () => {
    const created = await createVehicle(mockAdapter, { make: '', model: '' });

    expect(created).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inserts and returns a created vehicle', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const created = await createVehicle(mockAdapter, {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      color: 'White'
    });

    expect(created).not.toBeNull();
    expect(created?.make).toBe('Toyota');
    expect(created?.model).toBe('Camry');
    expect(created?.year).toBe(2022);
    expect(created?.color).toBe('White');
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns null from updateVehicle for invalid id', async () => {
    const updated = await updateVehicle(mockAdapter, ' ', {
      make: 'Honda',
      model: 'Civic',
      year: 2020
    });

    expect(updated).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('updates and returns vehicle by id', async () => {
    const now = Date.now();
    mockExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'vehicle-1',
          make: 'Honda',
          model: 'Civic',
          year: 2021,
          color: 'Gray',
          createdAt: now - 500,
          updatedAt: now
        }
      ]
    });

    const updated = await updateVehicle(mockAdapter, 'vehicle-1', {
      make: 'Honda',
      model: 'Civic',
      year: 2021,
      color: 'Gray'
    });

    expect(updated).toEqual({
      id: 'vehicle-1',
      make: 'Honda',
      model: 'Civic',
      year: 2021,
      color: 'Gray',
      createdAt: new Date(now - 500),
      updatedAt: new Date(now)
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('returns false from deleteVehicle for blank id', async () => {
    const deleted = await deleteVehicle(mockAdapter, ' ');

    expect(deleted).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('soft deletes a vehicle', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const deleted = await deleteVehicle(mockAdapter, 'vehicle-1');

    expect(deleted).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns null when getVehicleById has no rows', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const vehicle = await getVehicleById(mockAdapter, 'missing-id');

    expect(vehicle).toBeNull();
  });
});
