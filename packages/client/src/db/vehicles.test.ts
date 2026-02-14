import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from './adapters';
import {
  createVehicle,
  deleteVehicle,
  listVehicles,
  updateVehicle
} from './vehicles';

const mockAdapter: Pick<DatabaseAdapter, 'execute'> = {
  execute: vi.fn()
};

const mockIsDatabaseInitialized = vi.fn();
const mockGetDatabaseAdapter = vi.fn();

vi.mock('./index', () => ({
  isDatabaseInitialized: () => mockIsDatabaseInitialized(),
  getDatabaseAdapter: () => mockGetDatabaseAdapter()
}));

describe('vehicles db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseInitialized.mockReturnValue(true);
    mockGetDatabaseAdapter.mockReturnValue(mockAdapter);
  });

  it('returns empty list when database is not initialized', async () => {
    mockIsDatabaseInitialized.mockReturnValue(false);

    const vehicles = await listVehicles();

    expect(vehicles).toEqual([]);
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('maps rows from listVehicles query', async () => {
    const now = Date.now();
    vi.mocked(mockAdapter.execute).mockResolvedValueOnce({
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

    const vehicles = await listVehicles();

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
    const created = await createVehicle({ make: '', model: '' });

    expect(created).toBeNull();
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('inserts and returns a created vehicle', async () => {
    vi.mocked(mockAdapter.execute).mockResolvedValueOnce({ rows: [] });

    const created = await createVehicle({
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
    expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
  });

  it('returns null from updateVehicle for invalid id', async () => {
    const updated = await updateVehicle(' ', {
      make: 'Honda',
      model: 'Civic',
      year: 2020
    });

    expect(updated).toBeNull();
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('updates and returns vehicle by id', async () => {
    const now = Date.now();
    vi.mocked(mockAdapter.execute)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
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

    const updated = await updateVehicle('vehicle-1', {
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
    expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
  });

  it('returns false from deleteVehicle for blank id', async () => {
    const deleted = await deleteVehicle(' ');

    expect(deleted).toBe(false);
    expect(mockAdapter.execute).not.toHaveBeenCalled();
  });

  it('soft deletes a vehicle', async () => {
    vi.mocked(mockAdapter.execute).mockResolvedValueOnce({ rows: [] });

    const deleted = await deleteVehicle('vehicle-1');

    expect(deleted).toBe(true);
    expect(mockAdapter.execute).toHaveBeenCalledTimes(1);
  });
});
