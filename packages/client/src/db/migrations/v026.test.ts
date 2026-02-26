import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v026 } from './v026';

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

describe('v026 migration', () => {
  it('creates vfs_item_state table with indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const execute = vi.fn<DatabaseAdapter['execute']>();
    const adapter = createAdapter(executeMany, execute);

    await v026.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "vfs_item_state"'
    );
    expect(statements[0]).toContain(
      '"item_id" TEXT PRIMARY KEY REFERENCES "vfs_registry"("id") ON DELETE CASCADE'
    );
    expect(statements[0]).toContain('"encrypted_payload" TEXT');
    expect(statements[0]).toContain('"key_epoch" INTEGER');
    expect(statements[0]).toContain('"encryption_nonce" TEXT');
    expect(statements[0]).toContain('"encryption_aad" TEXT');
    expect(statements[0]).toContain('"encryption_signature" TEXT');
    expect(statements[0]).toContain('"updated_at" INTEGER NOT NULL');
    expect(statements[0]).toContain('"deleted_at" INTEGER');

    expect(statements[1]).toContain('vfs_item_state_updated_idx');
    expect(statements[2]).toContain('vfs_item_state_deleted_idx');
  });

  it('has correct version and description', () => {
    expect(v026.version).toBe(26);
    expect(v026.description).toBe('Add vfs_item_state table');
  });
});
