import { seedVfsItem, withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import { trashTestMigrations } from '../test/trashTestMigrations';
import { queryAllItems, queryDeletedItems } from './vfsQuery';
import type { VfsSortState } from './vfsTypes';

const DEFAULT_SORT: VfsSortState = { column: null, direction: null };

describe('vfsQuery integration (real database)', () => {
  it('queryAllItems uses canonical folder names without legacy fallback', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const canonicalFolderId = crypto.randomUUID();
        const legacyOnlyFolderId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Canonical Folder Name', now]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [legacyOnlyFolderId, 'folder', null, null, now + 1]
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);
        const canonicalRow = allItems.find(
          (row) => row.id === canonicalFolderId
        );
        const legacyOnlyRow = allItems.find(
          (row) => row.id === legacyOnlyFolderId
        );

        expect(canonicalRow?.name).toBe('Canonical Folder Name');
        expect(legacyOnlyRow?.name).toBe('Unnamed Folder');
      },
      { migrations: trashTestMigrations }
    );
  });

  it('queryDeletedItems returns empty set in canonical registry-only mode', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const deletedFileId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });
        const deletedContactId = await seedVfsItem(db, {
          objectType: 'contact',
          createLink: false
        });
        const deletedNoteId = await seedVfsItem(db, {
          objectType: 'note',
          createLink: false
        });
        const activeFileId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES ('${deletedFileId}', 'Deleted File', 1)`
        );
        await adapter.execute(
          `INSERT INTO contacts (id, first_name, last_name, deleted) VALUES ('${deletedContactId}', 'Deleted', 'Contact', 1)`
        );
        await adapter.execute(
          `INSERT INTO notes (id, title, deleted) VALUES ('${deletedNoteId}', 'Deleted Note', 1)`
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES ('${activeFileId}', 'Active File', 0)`
        );

        const deletedItems = await queryDeletedItems(db, DEFAULT_SORT);
        expect(deletedItems).toEqual([]);

        // Keep fixture references used so test setup remains explicit.
        expect(deletedFileId).toBeTypeOf('string');
        expect(deletedContactId).toBeTypeOf('string');
        expect(deletedNoteId).toBeTypeOf('string');
        expect(activeFileId).toBeTypeOf('string');
      },
      { migrations: trashTestMigrations }
    );
  });

  it('queryDeletedItems remains empty regardless of requested sort order', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const firstId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });
        // Ensure timestamp ordering is deterministic
        await new Promise((resolve) => setTimeout(resolve, 2));
        const secondId = await seedVfsItem(db, {
          objectType: 'file',
          createLink: false
        });

        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES ('${firstId}', 'First Deleted', 1)`
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES ('${secondId}', 'Second Deleted', 1)`
        );

        const rows = await queryDeletedItems(db, {
          column: 'createdAt',
          direction: 'desc'
        });

        expect(rows).toEqual([]);
        expect(firstId).toBeTypeOf('string');
        expect(secondId).toBeTypeOf('string');
      },
      { migrations: trashTestMigrations }
    );
  });
});
