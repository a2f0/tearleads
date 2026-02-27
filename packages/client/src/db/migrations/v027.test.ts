import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v027 } from './v027';

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

describe('v027 migration', () => {
  it('adds organization_id column and index to contacts and vfs_registry', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockImplementation(
      async (sql) => {
        if (typeof sql === 'string' && sql.startsWith('PRAGMA')) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    );
    const adapter = createAdapter(execute);

    await v027.up(adapter);

    const calls = execute.mock.calls.map((c) => c[0]);

    // Should check table_info for both tables
    expect(calls).toContainEqual('PRAGMA table_info("contacts")');
    expect(calls).toContainEqual('PRAGMA table_info("vfs_registry")');

    // Should add columns
    expect(calls).toContainEqual(
      'ALTER TABLE "contacts" ADD COLUMN "organization_id" TEXT'
    );
    expect(calls).toContainEqual(
      'ALTER TABLE "vfs_registry" ADD COLUMN "organization_id" TEXT'
    );

    // Should create indexes
    expect(calls).toContainEqual(
      'CREATE INDEX IF NOT EXISTS "contacts_org_idx" ON "contacts" ("organization_id")'
    );
    expect(calls).toContainEqual(
      'CREATE INDEX IF NOT EXISTS "vfs_registry_org_idx" ON "vfs_registry" ("organization_id")'
    );
  });

  it('skips ALTER TABLE when column already exists', async () => {
    const execute = vi.fn<DatabaseAdapter['execute']>().mockImplementation(
      async (sql) => {
        if (typeof sql === 'string' && sql.startsWith('PRAGMA')) {
          return { rows: [{ name: 'organization_id' }] };
        }
        return { rows: [] };
      }
    );
    const adapter = createAdapter(execute);

    await v027.up(adapter);

    const calls = execute.mock.calls.map((c) => c[0]);

    // Should NOT add columns since they exist
    expect(calls).not.toContainEqual(
      expect.stringContaining('ALTER TABLE')
    );

    // Should still create indexes (IF NOT EXISTS is idempotent)
    expect(calls).toContainEqual(
      'CREATE INDEX IF NOT EXISTS "contacts_org_idx" ON "contacts" ("organization_id")'
    );
    expect(calls).toContainEqual(
      'CREATE INDEX IF NOT EXISTS "vfs_registry_org_idx" ON "vfs_registry" ("organization_id")'
    );
  });

  it('has correct version and description', () => {
    expect(v027.version).toBe(27);
    expect(v027.description).toBe(
      'Add organization_id to contacts and vfs_registry'
    );
  });
});
