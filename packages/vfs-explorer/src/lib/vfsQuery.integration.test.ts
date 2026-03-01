import {
  seedVfsItem,
  vfsTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import {
  queryAllItems,
  queryDeletedItems,
  queryFolderContents,
  queryUnfiledItems
} from './vfsQuery';
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
      { migrations: vfsTestMigrations }
    );
  });

  it('queryUnfiledItems uses canonical folder names without legacy fallback', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const canonicalFolderId = crypto.randomUUID();
        const nullNameFolderId = crypto.randomUUID();
        const emptyNameFolderId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Inbox', now]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [nullNameFolderId, 'folder', null, null, now + 1]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [emptyNameFolderId, 'folder', null, '', now + 2]
        );

        const unfiledItems = await queryUnfiledItems(db, DEFAULT_SORT);
        const canonicalRow = unfiledItems.find(
          (row) => row.id === canonicalFolderId
        );
        const nullNameRow = unfiledItems.find(
          (row) => row.id === nullNameFolderId
        );
        const emptyNameRow = unfiledItems.find(
          (row) => row.id === emptyNameFolderId
        );

        expect(canonicalRow?.name).toBe('Inbox');
        expect(nullNameRow?.name).toBe('Unnamed Folder');
        expect(emptyNameRow?.name).toBe('Unnamed Folder');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryFolderContents uses canonical folder names without legacy fallback', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const parentId = crypto.randomUUID();
        const canonicalChildId = crypto.randomUUID();
        const nullNameChildId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [parentId, 'folder', null, 'Email Root', now]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalChildId, 'folder', null, 'Sent', now + 1]
        );
        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [nullNameChildId, 'folder', null, null, now + 2]
        );

        await adapter.execute(
          `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at) VALUES (?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            parentId,
            canonicalChildId,
            'wrapped-key',
            now + 3
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at) VALUES (?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            parentId,
            nullNameChildId,
            'wrapped-key',
            now + 4
          ]
        );

        const folderContents = await queryFolderContents(
          db,
          parentId,
          DEFAULT_SORT
        );
        const canonicalRow = folderContents.find(
          (row) => row.id === canonicalChildId
        );
        const nullNameRow = folderContents.find(
          (row) => row.id === nullNameChildId
        );

        expect(canonicalRow?.name).toBe('Sent');
        expect(nullNameRow?.name).toBe('Unnamed Folder');
      },
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
    );
  });

  it('queryAllItems resolves file names from the files table', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const fileId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fileId, 'file', null, null, now]
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES (?, ?, ?)`,
          [fileId, 'budget.xlsx', 0]
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);
        const row = allItems.find((r) => r.id === fileId);

        expect(row?.name).toBe('budget.xlsx');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryAllItems resolves note titles from the notes table', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const noteId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [noteId, 'note', null, null, now]
        );
        await adapter.execute(
          `INSERT INTO notes (id, title, deleted) VALUES (?, ?, ?)`,
          [noteId, 'Meeting Minutes', 0]
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);
        const row = allItems.find((r) => r.id === noteId);

        expect(row?.name).toBe('Meeting Minutes');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryAllItems resolves contact names from the contacts table', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const contactId = crypto.randomUUID();
        const firstOnlyId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [contactId, 'contact', null, null, now]
        );
        await adapter.execute(
          `INSERT INTO contacts (id, first_name, last_name, deleted) VALUES (?, ?, ?, ?)`,
          [contactId, 'Jane', 'Doe', 0]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [firstOnlyId, 'contact', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO contacts (id, first_name, last_name, deleted) VALUES (?, ?, ?, ?)`,
          [firstOnlyId, 'Alice', null, 0]
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);
        const fullNameRow = allItems.find((r) => r.id === contactId);
        const firstOnlyRow = allItems.find((r) => r.id === firstOnlyId);

        expect(fullNameRow?.name).toBe('Jane Doe');
        expect(firstOnlyRow?.name).toBe('Alice');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryAllItems resolves names from tag, playlist, album, and email tables', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const tagId = crypto.randomUUID();
        const playlistId = crypto.randomUUID();
        const albumId = crypto.randomUUID();
        const emailId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [tagId, 'tag', null, null, now]
        );
        await adapter.execute(
          `INSERT INTO tags (id, encrypted_name) VALUES (?, ?)`,
          [tagId, 'Important']
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [playlistId, 'playlist', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO playlists (id, encrypted_name) VALUES (?, ?)`,
          [playlistId, 'Road Trip Mix']
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [albumId, 'album', null, null, now + 2]
        );
        await adapter.execute(
          `INSERT INTO albums (id, encrypted_name) VALUES (?, ?)`,
          [albumId, 'Vacation 2026']
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [emailId, 'email', null, null, now + 3]
        );
        await adapter.execute(
          `INSERT INTO emails (id, encrypted_subject) VALUES (?, ?)`,
          [emailId, 'Re: Project Update']
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);

        expect(allItems.find((r) => r.id === tagId)?.name).toBe('Important');
        expect(allItems.find((r) => r.id === playlistId)?.name).toBe(
          'Road Trip Mix'
        );
        expect(allItems.find((r) => r.id === albumId)?.name).toBe(
          'Vacation 2026'
        );
        expect(allItems.find((r) => r.id === emailId)?.name).toBe(
          'Re: Project Update'
        );
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryAllItems prefers vfs_registry.encrypted_name over type-specific table', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const fileId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fileId, 'file', null, 'Renamed File.pdf', now]
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES (?, ?, ?)`,
          [fileId, 'original-upload.pdf', 0]
        );

        const allItems = await queryAllItems(db, DEFAULT_SORT);
        const row = allItems.find((r) => r.id === fileId);

        expect(row?.name).toBe('Renamed File.pdf');
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryFolderContents resolves names from type-specific tables', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const parentId = crypto.randomUUID();
        const fileId = crypto.randomUUID();
        const noteId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [parentId, 'folder', null, 'Documents', now]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fileId, 'file', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES (?, ?, ?)`,
          [fileId, 'report.pdf', 0]
        );
        await adapter.execute(
          `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at) VALUES (?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), parentId, fileId, 'key', now + 1]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [noteId, 'note', null, null, now + 2]
        );
        await adapter.execute(
          `INSERT INTO notes (id, title, deleted) VALUES (?, ?, ?)`,
          [noteId, 'Project Plan', 0]
        );
        await adapter.execute(
          `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at) VALUES (?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), parentId, noteId, 'key', now + 2]
        );

        const contents = await queryFolderContents(db, parentId, DEFAULT_SORT);

        expect(contents.find((r) => r.id === fileId)?.name).toBe('report.pdf');
        expect(contents.find((r) => r.id === noteId)?.name).toBe(
          'Project Plan'
        );
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('queryUnfiledItems resolves names from type-specific tables', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const fileId = crypto.randomUUID();
        const tagId = crypto.randomUUID();
        const now = Date.now();

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [fileId, 'file', null, null, now]
        );
        await adapter.execute(
          `INSERT INTO files (id, name, deleted) VALUES (?, ?, ?)`,
          [fileId, 'orphan-doc.txt', 0]
        );

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [tagId, 'tag', null, null, now + 1]
        );
        await adapter.execute(
          `INSERT INTO tags (id, encrypted_name) VALUES (?, ?)`,
          [tagId, 'Urgent']
        );

        const unfiled = await queryUnfiledItems(db, DEFAULT_SORT);

        expect(unfiled.find((r) => r.id === fileId)?.name).toBe(
          'orphan-doc.txt'
        );
        expect(unfiled.find((r) => r.id === tagId)?.name).toBe('Urgent');
      },
      { migrations: vfsTestMigrations }
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
      { migrations: vfsTestMigrations }
    );
  });
});
