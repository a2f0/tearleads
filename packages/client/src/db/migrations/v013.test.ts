import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v013 } from './v013';

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
  getConnection: vi.fn(() => null),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v013 migration', () => {
  it('creates vfs_shares table and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v013.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(5);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "vfs_shares"');
    expect(statements[0]).toContain('"item_id" TEXT NOT NULL');
    expect(statements[0]).toContain('"created_by" TEXT NOT NULL');
    expect(statements[1]).toContain('vfs_shares_item_idx');
    expect(statements[2]).toContain('vfs_shares_target_idx');
    expect(statements[3]).toContain('vfs_shares_item_target_type_idx');
    expect(statements[4]).toContain('vfs_shares_expires_idx');
  });
});
