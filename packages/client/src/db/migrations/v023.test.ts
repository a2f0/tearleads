import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v023 } from './v023';

const createAdapter = (
  execute: DatabaseAdapter['execute']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute,
  executeMany: vi.fn(async () => {}),
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v023 migration', () => {
  it('adds canonical folder metadata columns to vfs_registry', async () => {
    const execute = vi
      .fn<DatabaseAdapter['execute']>()
      .mockImplementation(async (query) => {
        if (query.startsWith('PRAGMA table_info("vfs_registry")')) {
          return { rows: [] };
        }
        return { rows: [] };
      });
    const adapter = createAdapter(execute);

    await v023.up(adapter);

    const statements = execute.mock.calls.map(([query]) => query);
    expect(statements).toContain(
      'ALTER TABLE "vfs_registry" ADD COLUMN "encrypted_name" TEXT'
    );
    expect(statements).toContain(
      'ALTER TABLE "vfs_registry" ADD COLUMN "icon" TEXT'
    );
    expect(statements).toContain(
      'ALTER TABLE "vfs_registry" ADD COLUMN "view_mode" TEXT'
    );
    expect(statements).toContain(
      'ALTER TABLE "vfs_registry" ADD COLUMN "default_sort" TEXT'
    );
    expect(statements).toContain(
      'ALTER TABLE "vfs_registry" ADD COLUMN "sort_direction" TEXT'
    );
  });
});
