import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v018 } from './v018';

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

describe('v018 migration', () => {
  it('creates vehicles table and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v018.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(5);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "vehicles"');
    expect(statements[0]).toContain('"make" TEXT NOT NULL');
    expect(statements[0]).toContain('"model" TEXT NOT NULL');
    expect(statements[1]).toContain('vehicles_updated_at_idx');
    expect(statements[2]).toContain('vehicles_make_model_idx');
    expect(statements[3]).toContain('vehicles_year_idx');
    expect(statements[4]).toContain('vehicles_deleted_idx');
  });
});
