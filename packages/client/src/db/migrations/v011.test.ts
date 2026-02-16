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

describe('v011 migration', () => {
  it('creates missing VFS extension tables', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v011.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toEqual([
      'CREATE TABLE IF NOT EXISTS "contact_groups" (\n' +
        '        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,\n' +
        '        "encrypted_name" TEXT,\n' +
        '        "color" TEXT,\n' +
        '        "icon" TEXT\n' +
        '      )',
      'CREATE TABLE IF NOT EXISTS "email_folders" (\n' +
        '        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,\n' +
        '        "encrypted_name" TEXT,\n' +
        '        "folder_type" TEXT,\n' +
        '        "unread_count" INTEGER NOT NULL DEFAULT 0,\n' +
        '        "sync_uid_validity" INTEGER,\n' +
        '        "sync_last_uid" INTEGER\n' +
        '      )',
      'CREATE TABLE IF NOT EXISTS "tags" (\n' +
        '        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,\n' +
        '        "encrypted_name" TEXT,\n' +
        '        "color" TEXT,\n' +
        '        "icon" TEXT\n' +
        '      )',
      'CREATE TABLE IF NOT EXISTS "emails" (\n' +
        '        "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,\n' +
        '        "encrypted_subject" TEXT,\n' +
        '        "encrypted_from" TEXT,\n' +
        '        "encrypted_to" TEXT,\n' +
        '        "encrypted_cc" TEXT,\n' +
        '        "encrypted_body_path" TEXT,\n' +
        '        "received_at" INTEGER NOT NULL,\n' +
        '        "is_read" INTEGER NOT NULL DEFAULT 0 CHECK("is_read" IN (0, 1)),\n' +
        '        "is_starred" INTEGER NOT NULL DEFAULT 0 CHECK("is_starred" IN (0, 1))\n' +
        '      )',
      'CREATE INDEX IF NOT EXISTS "emails_received_at_idx" ON "emails" ("received_at")'
    ]);
  });
});
