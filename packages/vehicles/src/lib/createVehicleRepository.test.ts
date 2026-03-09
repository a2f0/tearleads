import * as schema from '@tearleads/db/sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVehicleRepository } from './createVehicleRepository.js';

type VehicleRow = typeof schema.vehicles.$inferSelect;

function toVehicleArray(row: VehicleRow): unknown[] {
  return [
    row.id,
    row.make,
    row.model,
    row.year,
    row.color,
    row.createdAt.getTime(),
    row.updatedAt.getTime(),
    row.deleted ? 1 : 0
  ];
}

function createVehicleRow(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: 'vehicle-1',
    make: 'Tesla',
    model: 'Model Y',
    year: 2024,
    color: 'Blue',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    deleted: false,
    ...overrides
  };
}

function compareVehicles(left: VehicleRow, right: VehicleRow): number {
  if (right.updatedAt.getTime() !== left.updatedAt.getTime()) {
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  }

  const makeComparison = left.make.localeCompare(right.make, undefined, {
    sensitivity: 'base'
  });
  if (makeComparison !== 0) {
    return makeComparison;
  }

  return left.model.localeCompare(right.model, undefined, {
    sensitivity: 'base'
  });
}

function createTestDatabase(initialRows: VehicleRow[] = []) {
  const rows = new Map(
    initialRows.map(
      (row) => [row.id, { ...row }] satisfies [string, VehicleRow]
    )
  );

  const connection = vi.fn(
    async (sql: string, params: unknown[], method: string) => {
      if (
        method === 'all' &&
        sql.startsWith(
          'select "id", "make", "model", "year", "color", "created_at", "updated_at", "deleted" from "vehicles" where ("vehicles"."id" = ? and "vehicles"."deleted" = ?) limit ?'
        )
      ) {
        const [id] = params;
        const row = rows.get(String(id));

        return {
          rows: row && !row.deleted ? [toVehicleArray(row)] : []
        };
      }

      if (
        method === 'all' &&
        sql.startsWith(
          'select "id", "make", "model", "year", "color", "created_at", "updated_at", "deleted" from "vehicles" where "vehicles"."deleted" = ? order by'
        )
      ) {
        return {
          rows: [...rows.values()]
            .filter((row) => !row.deleted)
            .sort(compareVehicles)
            .map(toVehicleArray)
        };
      }

      if (
        method === 'all' &&
        sql.startsWith(
          'select "id" from "vehicles" where ("vehicles"."id" = ? and "vehicles"."deleted" = ?) limit ?'
        )
      ) {
        const [id] = params;
        const row = rows.get(String(id));

        return {
          rows: row && !row.deleted ? [[row.id]] : []
        };
      }

      if (
        method === 'run' &&
        sql.startsWith(
          'insert into "vehicles" ("id", "make", "model", "year", "color", "created_at", "updated_at", "deleted") values'
        )
      ) {
        const [id, make, model, year, color, createdAt, updatedAt, deleted] =
          params;

        rows.set(String(id), {
          id: String(id),
          make: String(make),
          model: String(model),
          year: year === null ? null : Number(year),
          color: color === null ? null : String(color),
          createdAt: new Date(Number(createdAt)),
          updatedAt: new Date(Number(updatedAt)),
          deleted: deleted === 1
        });

        return { rows: [] };
      }

      if (
        method === 'run' &&
        sql.startsWith(
          'update "vehicles" set "make" = ?, "model" = ?, "year" = ?, "color" = ?, "updated_at" = ? where'
        )
      ) {
        const [make, model, year, color, updatedAt, id] = params;
        const row = rows.get(String(id));

        if (row && !row.deleted) {
          rows.set(row.id, {
            ...row,
            make: String(make),
            model: String(model),
            year: year === null ? null : Number(year),
            color: color === null ? null : String(color),
            updatedAt: new Date(Number(updatedAt))
          });
        }

        return { rows: [] };
      }

      if (
        method === 'run' &&
        sql.startsWith(
          'update "vehicles" set "updated_at" = ?, "deleted" = ? where'
        )
      ) {
        const [updatedAt, deleted, id] = params;
        const row = rows.get(String(id));

        if (row && !row.deleted) {
          rows.set(row.id, {
            ...row,
            updatedAt: new Date(Number(updatedAt)),
            deleted: deleted === 1
          });
        }

        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${method} ${sql}`);
    }
  );

  return {
    rows,
    connection,
    db: drizzle(connection, { schema })
  };
}

describe('createVehicleRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns active vehicles by id and in list order', async () => {
    const newest = createVehicleRow({
      id: 'vehicle-2',
      make: 'Ford',
      model: 'Mustang',
      updatedAt: new Date('2024-01-03T00:00:00.000Z')
    });
    const deleted = createVehicleRow({
      id: 'vehicle-3',
      make: 'Audi',
      model: 'Q5',
      deleted: true
    });
    const { db } = createTestDatabase([createVehicleRow(), newest, deleted]);
    const repository = createVehicleRepository(db);

    await expect(repository.getVehicleById('vehicle-1')).resolves.toMatchObject(
      {
        id: 'vehicle-1',
        make: 'Tesla',
        model: 'Model Y'
      }
    );
    await expect(repository.getVehicleById('vehicle-3')).resolves.toBeNull();
    await expect(repository.getVehicleById('missing')).resolves.toBeNull();

    await expect(repository.listVehicles()).resolves.toMatchObject([
      { id: 'vehicle-2', make: 'Ford' },
      { id: 'vehicle-1', make: 'Tesla' }
    ]);
  });

  it('creates normalized vehicles and persists them through the proxy', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001'
    );

    const { db, rows } = createTestDatabase();
    const repository = createVehicleRepository(db);

    const created = await repository.createVehicle({
      make: ' Tesla ',
      model: ' Model Y ',
      year: 2024,
      color: ' Blue '
    });

    expect(created).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      make: 'Tesla',
      model: 'Model Y',
      year: 2024,
      color: 'Blue'
    });
    expect(rows.get('00000000-0000-4000-8000-000000000001')).toMatchObject({
      deleted: false,
      make: 'Tesla',
      model: 'Model Y'
    });
  });

  it('returns null for invalid create/update inputs and missing updates', async () => {
    const { db, connection } = createTestDatabase();
    const repository = createVehicleRepository(db);

    await expect(
      repository.createVehicle({ make: '', model: '' })
    ).resolves.toBeNull();
    await expect(
      repository.updateVehicle(' ', {
        make: 'Tesla',
        model: 'Model Y'
      })
    ).resolves.toBeNull();
    await expect(
      repository.updateVehicle('vehicle-1', {
        make: '',
        model: 'Model Y'
      })
    ).resolves.toBeNull();
    await expect(
      repository.updateVehicle('missing', {
        make: 'Tesla',
        model: 'Model Y',
        year: 2025,
        color: 'Black'
      })
    ).resolves.toBeNull();

    expect(connection).toHaveBeenCalledTimes(2);
  });

  it('updates and soft deletes active vehicles', async () => {
    const { db, rows } = createTestDatabase([createVehicleRow()]);
    const repository = createVehicleRepository(db);

    const updated = await repository.updateVehicle('vehicle-1', {
      make: 'Tesla',
      model: 'Model Y Performance',
      year: 2025,
      color: ''
    });

    expect(updated).toMatchObject({
      id: 'vehicle-1',
      model: 'Model Y Performance',
      year: 2025,
      color: null
    });
    expect(rows.get('vehicle-1')).toMatchObject({
      deleted: false,
      model: 'Model Y Performance'
    });

    await expect(repository.deleteVehicle(' ')).resolves.toBe(false);
    await expect(repository.deleteVehicle('missing')).resolves.toBe(false);
    await expect(repository.deleteVehicle('vehicle-1')).resolves.toBe(true);
    await expect(repository.deleteVehicle('vehicle-1')).resolves.toBe(false);
    expect(rows.get('vehicle-1')?.deleted).toBe(true);
  });
});
