import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '../adapter/index.js';
import { v031 } from './v031.js';

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

describe('v031 migration', () => {
  it('creates health height table and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v031.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "health_height_readings"'
    );
    expect(statements[1]).toContain('health_height_readings_recorded_at_idx');
    expect(statements[2]).toContain('health_height_readings_contact_idx');
  });
});
