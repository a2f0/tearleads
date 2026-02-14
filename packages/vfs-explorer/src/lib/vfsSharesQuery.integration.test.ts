import {
  type Migration,
  vfsTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { describe, expect, it, vi } from 'vitest';
import { querySharedByMe } from './vfsSharesQuery';

const vfsSharesEnabledMigrations: Migration[] = [
  ...vfsTestMigrations,
  {
    version: 2,
    up: async (adapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_shares (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          share_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          permission_level TEXT NOT NULL,
          wrapped_session_key TEXT,
          created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER
        )
      `);
    }
  }
];

describe('vfsSharesQuery integration (real database)', () => {
  it('returns empty results when vfs_shares table is unavailable', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await withRealDatabase(
      async ({ db }) => {
        const rows = await querySharedByMe(db, 'user-1', {
          column: null,
          direction: null
        });

        expect(rows).toEqual([]);
      },
      { migrations: vfsTestMigrations }
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing required table "vfs_shares"'),
      expect.anything()
    );
    consoleErrorSpy.mockRestore();
  });

  it('prefers canonical folder names with legacy fallback when reading shares', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const ownerId = 'owner-user';
        const now = Date.now();
        const canonicalFolderId = crypto.randomUUID();
        const fallbackFolderId = crypto.randomUUID();

        await adapter.execute(`INSERT INTO users (id, email) VALUES (?, ?)`, [
          ownerId,
          'owner@example.com'
        ]);

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Canonical Shared Name', now]
        );
        await adapter.execute(
          `INSERT INTO vfs_folders (id, encrypted_name) VALUES (?, ?)`,
          [canonicalFolderId, 'Legacy Shared Name']
        );
        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fallbackFolderId, 'folder', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO vfs_folders (id, encrypted_name) VALUES (?, ?)`,
          [fallbackFolderId, 'Legacy Shared Fallback']
        );

        await adapter.execute(
          `INSERT INTO vfs_shares (id, item_id, share_type, target_id, permission_level, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            canonicalFolderId,
            'user',
            'target-user-1',
            'view',
            ownerId,
            now
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_shares (id, item_id, share_type, target_id, permission_level, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            fallbackFolderId,
            'user',
            'target-user-2',
            'view',
            ownerId,
            now + 1
          ]
        );

        const rows = await querySharedByMe(db, ownerId, {
          column: null,
          direction: null
        });

        const canonicalRow = rows.find((row) => row.id === canonicalFolderId);
        const fallbackRow = rows.find((row) => row.id === fallbackFolderId);

        expect(canonicalRow?.name).toBe('Canonical Shared Name');
        expect(fallbackRow?.name).toBe('Legacy Shared Fallback');
      },
      { migrations: vfsSharesEnabledMigrations }
    );
  });
});
