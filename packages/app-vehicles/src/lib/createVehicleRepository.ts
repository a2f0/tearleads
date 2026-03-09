import type { Database } from '@tearleads/db/sqlite';
import { vehicles } from '@tearleads/db/sqlite';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { VehicleProfileInput } from './vehicleProfile.js';
import { normalizeVehicleProfile } from './vehicleProfile.js';
import type { VehicleRecord, VehicleRepository } from './vehicleRepository.js';

function toVehicleRecord(row: typeof vehicles.$inferSelect): VehicleRecord {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function createVehicleRepository(db: Database): VehicleRepository {
  return {
    async getVehicleById(id: string): Promise<VehicleRecord | null> {
      const rows = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, id), eq(vehicles.deleted, false)))
        .limit(1);

      const row = rows[0];
      return row === undefined ? null : toVehicleRecord(row);
    },

    async listVehicles(): Promise<VehicleRecord[]> {
      const rows = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.deleted, false))
        .orderBy(
          desc(vehicles.updatedAt),
          asc(vehicles.make),
          asc(vehicles.model)
        );

      return rows.map(toVehicleRecord);
    },

    async createVehicle(
      input: VehicleProfileInput
    ): Promise<VehicleRecord | null> {
      const normalized = normalizeVehicleProfile(input);
      if (!normalized.ok) {
        return null;
      }

      const now = new Date();
      const createdVehicle: VehicleRecord = {
        id: crypto.randomUUID(),
        make: normalized.value.make,
        model: normalized.value.model,
        year: normalized.value.year,
        color: normalized.value.color,
        createdAt: now,
        updatedAt: now
      };

      await db.insert(vehicles).values({
        id: createdVehicle.id,
        make: createdVehicle.make,
        model: createdVehicle.model,
        year: createdVehicle.year,
        color: createdVehicle.color,
        createdAt: createdVehicle.createdAt,
        updatedAt: createdVehicle.updatedAt,
        deleted: false
      });

      return createdVehicle;
    },

    async updateVehicle(
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

      await db
        .update(vehicles)
        .set({
          make: normalized.value.make,
          model: normalized.value.model,
          year: normalized.value.year,
          color: normalized.value.color,
          updatedAt: new Date()
        })
        .where(and(eq(vehicles.id, id), eq(vehicles.deleted, false)));

      const rows = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, id), eq(vehicles.deleted, false)))
        .limit(1);

      const row = rows[0];
      return row === undefined ? null : toVehicleRecord(row);
    },

    async deleteVehicle(id: string): Promise<boolean> {
      if (id.trim().length === 0) {
        return false;
      }

      const existing = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.id, id), eq(vehicles.deleted, false)))
        .limit(1);

      if (existing[0] === undefined) {
        return false;
      }

      await db
        .update(vehicles)
        .set({
          deleted: true,
          updatedAt: new Date()
        })
        .where(and(eq(vehicles.id, id), eq(vehicles.deleted, false)));

      return true;
    }
  };
}
