import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import { fetchItemNames } from './vfsNameLookup';

describe('vfsNameLookup integration (real database)', () => {
  it('uses canonical folder names without legacy fallback', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const canonicalFolderId = crypto.randomUUID();
        const legacyOnlyFolderId = crypto.randomUUID();
        const unnamedFolderId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Canonical Folder Name', now]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [legacyOnlyFolderId, 'folder', null, null, now + 1]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [unnamedFolderId, 'folder', null, '', now + 2]
        );

        const names = await fetchItemNames(db, {
          folder: [canonicalFolderId, legacyOnlyFolderId, unnamedFolderId]
        });

        expect(names.get(canonicalFolderId)).toBe('Canonical Folder Name');
        expect(names.get(legacyOnlyFolderId)).toBe('Unnamed Folder');
        expect(names.get(unnamedFolderId)).toBe('Unnamed Folder');
      },
      { migrations: vfsTestMigrations }
    );
  });
});
