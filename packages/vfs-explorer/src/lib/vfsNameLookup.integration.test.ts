import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import { fetchItemNames } from './vfsNameLookup';

describe('vfsNameLookup integration (real database)', () => {
  it('prefers canonical folder names with legacy fallback', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const canonicalFolderId = crypto.randomUUID();
        const fallbackFolderId = crypto.randomUUID();
        const unnamedFolderId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Canonical Folder Name', now]
        );
        await adapter.execute(
          `INSERT INTO vfs_folders (id, encrypted_name) VALUES (?, ?)`,
          [canonicalFolderId, 'Legacy Folder Name']
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fallbackFolderId, 'folder', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO vfs_folders (id, encrypted_name) VALUES (?, ?)`,
          [fallbackFolderId, 'Legacy Fallback Name']
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [unnamedFolderId, 'folder', null, '', now + 2]
        );

        const names = await fetchItemNames(db, {
          folder: [canonicalFolderId, fallbackFolderId, unnamedFolderId]
        });

        expect(names.get(canonicalFolderId)).toBe('Canonical Folder Name');
        expect(names.get(fallbackFolderId)).toBe('Legacy Fallback Name');
        expect(names.get(unnamedFolderId)).toBe('Unnamed Folder');
      },
      { migrations: vfsTestMigrations }
    );
  });
});
