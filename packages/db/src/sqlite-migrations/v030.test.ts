import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapter/index.js';
import { v030 } from './v030.js';

const createAdapter = (): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute: vi
    .fn<DatabaseAdapter['execute']>()
    .mockResolvedValue({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] }),
  executeMany: vi.fn(async () => {}),
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v030 migration', () => {
  it('adds contact_id columns and indexes to health reading tables', async () => {
    const adapter = createAdapter();

    await v030.up(adapter);

    expect(adapter.execute).toHaveBeenCalledWith(
      'PRAGMA table_info("health_weight_readings")'
    );
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "health_weight_readings" ADD COLUMN "contact_id" TEXT'
    );

    expect(adapter.execute).toHaveBeenCalledWith(
      'PRAGMA table_info("health_blood_pressure_readings")'
    );
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "health_blood_pressure_readings" ADD COLUMN "contact_id" TEXT'
    );

    expect(adapter.execute).toHaveBeenCalledWith(
      'PRAGMA table_info("health_workout_entries")'
    );
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "health_workout_entries" ADD COLUMN "contact_id" TEXT'
    );

    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "health_weight_readings_contact_idx" ON "health_weight_readings" ("contact_id")'
    );
    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "health_blood_pressure_contact_idx" ON "health_blood_pressure_readings" ("contact_id")'
    );
    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "health_workout_entries_contact_idx" ON "health_workout_entries" ("contact_id")'
    );
  });
});
