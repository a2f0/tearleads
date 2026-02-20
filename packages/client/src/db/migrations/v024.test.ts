import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v024 } from './v024';

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

describe('v024 migration', () => {
  it('creates vfs_item_keys and vfs_item_shares tables with indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v024.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(5);

    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_item_keys"'
    );
    expect(statements[0]).toContain('"item_id" TEXT NOT NULL');
    expect(statements[0]).toContain('"key_epoch" INTEGER NOT NULL');
    expect(statements[0]).toContain('"session_key_b64" TEXT NOT NULL');
    expect(statements[0]).toContain('PRIMARY KEY ("item_id", "key_epoch")');

    expect(statements[1]).toContain('vfs_item_keys_item_id_idx');

    expect(statements[2]).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_item_shares"'
    );
    expect(statements[2]).toContain('"recipient_user_id" TEXT NOT NULL');
    expect(statements[2]).toContain(
      'PRIMARY KEY ("item_id", "recipient_user_id", "key_epoch")'
    );

    expect(statements[3]).toContain('vfs_item_shares_item_id_idx');
    expect(statements[4]).toContain('vfs_item_shares_recipient_idx');
  });

  it('has correct version and description', () => {
    expect(v024.version).toBe(24);
    expect(v024.description).toBe('Add VFS item encryption keys tables');
  });
});
