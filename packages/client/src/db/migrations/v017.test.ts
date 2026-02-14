import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v017 } from './v017';

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

describe('v017 migration', () => {
  it('creates wallet item tables and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v017.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(9);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "wallet_items"'
    );
    expect(statements[0]).toContain('"item_type" TEXT NOT NULL');
    expect(statements[5]).toContain(
      'CREATE TABLE IF NOT EXISTS "wallet_item_media"'
    );
    expect(statements[5]).toContain('"wallet_item_id" TEXT NOT NULL');
    expect(statements[8]).toContain('wallet_item_media_item_side_idx');
  });
});
