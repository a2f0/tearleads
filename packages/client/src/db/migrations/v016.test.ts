import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v016 } from './v016';

const createAdapter = (
  executeMany: DatabaseAdapter['executeMany']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute: vi.fn(async () => ({ rows: [] })),
  executeMany,
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v016 migration', () => {
  it('creates health tracking tables and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v016.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(9);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "health_exercises"'
    );
    expect(statements[1]).toContain('health_exercises_name_idx');
    expect(statements[2]).toContain(
      'CREATE TABLE IF NOT EXISTS "health_weight_readings"'
    );
    expect(statements[3]).toContain('health_weight_readings_recorded_at_idx');
    expect(statements[4]).toContain(
      'CREATE TABLE IF NOT EXISTS "health_blood_pressure_readings"'
    );
    expect(statements[5]).toContain('health_blood_pressure_recorded_at_idx');
    expect(statements[6]).toContain(
      'CREATE TABLE IF NOT EXISTS "health_workout_entries"'
    );
    expect(statements[7]).toContain('health_workout_entries_performed_at_idx');
    expect(statements[8]).toContain('health_workout_entries_exercise_idx');
  });
});
