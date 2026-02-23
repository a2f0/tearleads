import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v025 } from './v025';

const createAdapter = (
  executeMany: DatabaseAdapter['executeMany'],
  execute: DatabaseAdapter['execute']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute,
  executeMany,
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v025 migration', () => {
  it('creates vfs_acl_entries table with indexes and key_epoch column', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const execute = vi
      .fn<DatabaseAdapter['execute']>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const adapter = createAdapter(executeMany, execute);

    await v025.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(5);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_acl_entries"'
    );
    expect(statements[0]).toContain('"item_id" TEXT NOT NULL');
    expect(statements[0]).toContain('"wrapped_session_key" TEXT');
    expect(statements[0]).toContain('"granted_by" TEXT REFERENCES "users"("id")');

    expect(statements[1]).toContain('vfs_acl_entries_item_idx');
    expect(statements[2]).toContain('vfs_acl_entries_principal_idx');
    expect(statements[3]).toContain('vfs_acl_entries_active_idx');
    expect(statements[4]).toContain('vfs_acl_entries_item_principal_idx');

    expect(execute).toHaveBeenNthCalledWith(
      1,
      'PRAGMA table_info("vfs_acl_entries")'
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'ALTER TABLE "vfs_acl_entries" ADD COLUMN "key_epoch" INTEGER'
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('has correct version and description', () => {
    expect(v025.version).toBe(25);
    expect(v025.description).toBe('Add canonical VFS ACL entries table');
  });
});
