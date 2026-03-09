import type { DatabaseAdapter } from '@tearleads/db/adapter';
import { isRecord, toFiniteNumber } from '@tearleads/shared';
import type { VehicleProfileInput } from './vehicleProfile.js';
import { normalizeVehicleProfile } from './vehicleProfile.js';
import type { VehicleRecord } from './vehicleRepository.js';

export type { VehicleRecord } from './vehicleRepository.js';

interface RawVehicleRow {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  createdAt: number;
  updatedAt: number;
}

function normalizeVehicleRow(value: unknown): RawVehicleRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const make = value['make'];
  const model = value['model'];
  if (
    typeof id !== 'string' ||
    typeof make !== 'string' ||
    typeof model !== 'string'
  ) {
    return null;
  }

  const yearRaw = value['year'];
  let year: number | null = null;
  if (yearRaw !== null && yearRaw !== undefined) {
    const parsedYear = toFiniteNumber(yearRaw);
    if (parsedYear === null || !Number.isInteger(parsedYear)) {
      return null;
    }
    year = parsedYear;
  }

  const colorRaw = value['color'];
  if (
    colorRaw !== null &&
    colorRaw !== undefined &&
    typeof colorRaw !== 'string'
  ) {
    return null;
  }

  const createdAt = toFiniteNumber(value['createdAt']);
  const updatedAt = toFiniteNumber(value['updatedAt']);
  if (createdAt === null || updatedAt === null) {
    return null;
  }

  return {
    id,
    make,
    model,
    year,
    color: typeof colorRaw === 'string' ? colorRaw : null,
    createdAt,
    updatedAt
  };
}

function toVehicleRecord(row: RawVehicleRow): VehicleRecord {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}

export async function getVehicleById(
  adapter: DatabaseAdapter,
  id: string
): Promise<VehicleRecord | null> {
  const result = await adapter.execute(
    `SELECT
      id,
      make,
      model,
      year,
      color,
      created_at as createdAt,
      updated_at as updatedAt
    FROM vehicles
    WHERE id = ?
      AND deleted = 0
    LIMIT 1`,
    [id]
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const normalized = normalizeVehicleRow(row);
  return normalized === null ? null : toVehicleRecord(normalized);
}

export async function listVehicles(
  adapter: DatabaseAdapter
): Promise<VehicleRecord[]> {
  const result = await adapter.execute(
    `SELECT
      id,
      make,
      model,
      year,
      color,
      created_at as createdAt,
      updated_at as updatedAt
    FROM vehicles
    WHERE deleted = 0
    ORDER BY updated_at DESC, make ASC, model ASC`,
    []
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map(normalizeVehicleRow)
    .filter((row): row is RawVehicleRow => row !== null)
    .map(toVehicleRecord);
}

export async function createVehicle(
  adapter: DatabaseAdapter,
  input: VehicleProfileInput
): Promise<VehicleRecord | null> {
  const normalized = normalizeVehicleProfile(input);
  if (!normalized.ok) {
    return null;
  }
  const now = Date.now();
  const id = crypto.randomUUID();

  await adapter.execute(
    `INSERT INTO vehicles (
      id,
      make,
      model,
      year,
      color,
      created_at,
      updated_at,
      deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      normalized.value.make,
      normalized.value.model,
      normalized.value.year,
      normalized.value.color,
      now,
      now
    ]
  );

  return {
    id,
    make: normalized.value.make,
    model: normalized.value.model,
    year: normalized.value.year,
    color: normalized.value.color,
    createdAt: new Date(now),
    updatedAt: new Date(now)
  };
}

export async function updateVehicle(
  adapter: DatabaseAdapter,
  id: string,
  input: VehicleProfileInput
): Promise<VehicleRecord | null> {
  if (id.trim().length === 0) {
    return null;
  }

  const normalized = normalizeVehicleProfile(input);
  if (!normalized.ok) {
    return null;
  }
  await adapter.execute(
    `UPDATE vehicles
    SET
      make = ?,
      model = ?,
      year = ?,
      color = ?,
      updated_at = ?
    WHERE id = ?
      AND deleted = 0`,
    [
      normalized.value.make,
      normalized.value.model,
      normalized.value.year,
      normalized.value.color,
      Date.now(),
      id
    ]
  );

  return getVehicleById(adapter, id);
}

export async function deleteVehicle(
  adapter: DatabaseAdapter,
  id: string
): Promise<boolean> {
  if (id.trim().length === 0) {
    return false;
  }
  await adapter.execute(
    `UPDATE vehicles
    SET
      deleted = 1,
      updated_at = ?
    WHERE id = ?
      AND deleted = 0`,
    [Date.now(), id]
  );

  return true;
}
