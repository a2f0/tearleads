import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v011 } from './v011';

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

const EXPECTED_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "contact_groups" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      )`,
  `CREATE TABLE IF NOT EXISTS "tags" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_name" TEXT,
        "color" TEXT,
        "icon" TEXT
      )`,
  `CREATE TABLE IF NOT EXISTS "emails" (
        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
        "encrypted_subject" TEXT,
        "encrypted_from" TEXT,
        "encrypted_to" TEXT,
        "encrypted_cc" TEXT,
        "encrypted_body_path" TEXT,
        "received_at" INTEGER NOT NULL,
        "is_read" INTEGER NOT NULL DEFAULT 0 CHECK("is_read" IN (0, 1)),
        "is_starred" INTEGER NOT NULL DEFAULT 0 CHECK("is_starred" IN (0, 1))
      )`,
  `CREATE INDEX IF NOT EXISTS "emails_received_at_idx" ON "emails" ("received_at")`
];

describe('v011 migration', () => {
  it('creates missing VFS extension tables', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v011.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toEqual(EXPECTED_STATEMENTS);
  });
});
