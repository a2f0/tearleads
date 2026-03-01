import { vfsTestMigrations, withRealDatabase } from '@tearleads/db-test-utils';
import { describe, expect, it } from 'vitest';
import { vfsAclEnabledMigrations } from '../test/vfsAclTestMigrations';
import { querySharedByMe, querySharedWithMe } from './vfsSharesQuery';

describe('vfsSharesQuery integration (real database)', () => {
  it('fails when canonical ACL table is unavailable', async () => {
    await withRealDatabase(
      async ({ db }) => {
        await expect(
          querySharedByMe(db, 'user-1', {
            column: null,
            direction: null
          })
        ).rejects.toThrow(/vfs_acl_entries/u);
      },
      { migrations: vfsTestMigrations }
    );
  });

  it('reads shared-by-me rows from canonical ACL ids and levels', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const ownerId = 'owner-user';
        const now = Date.now();
        const canonicalFolderId = crypto.randomUUID();
        const legacyOnlyFolderId = crypto.randomUUID();

        await adapter.execute(`INSERT INTO users (id, email) VALUES (?, ?)`, [
          ownerId,
          'owner@example.com'
        ]);

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [canonicalFolderId, 'folder', null, 'Canonical Shared Name', now]
        );
        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [legacyOnlyFolderId, 'folder', null, null, now + 1]
        );

        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'share:share-by-me-canonical',
            canonicalFolderId,
            'user',
            'target-user-1',
            'read',
            ownerId,
            now,
            now
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'share:share-by-me-legacy-name',
            legacyOnlyFolderId,
            'user',
            'target-user-2',
            'admin',
            ownerId,
            now + 1,
            now + 1
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'org-share:source-org:ignored',
            canonicalFolderId,
            'organization',
            'target-org-1',
            'read',
            ownerId,
            now + 2,
            now + 2
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'share:revoked-entry',
            canonicalFolderId,
            'user',
            'target-user-3',
            'write',
            ownerId,
            now + 3,
            now + 3,
            now + 3
          ]
        );

        const rows = await querySharedByMe(db, ownerId, {
          column: null,
          direction: null
        });

        const canonicalRow = rows.find((row) => row.id === canonicalFolderId);
        const legacyOnlyRow = rows.find((row) => row.id === legacyOnlyFolderId);

        expect(rows).toHaveLength(2);
        expect(canonicalRow?.shareId).toBe('share-by-me-canonical');
        expect(canonicalRow?.name).toBe('Canonical Shared Name');
        expect(canonicalRow?.permissionLevel).toBe('view');
        expect(legacyOnlyRow?.shareId).toBe('share-by-me-legacy-name');
        expect(legacyOnlyRow?.name).toBe('Unnamed Folder');
        expect(legacyOnlyRow?.permissionLevel).toBe('edit');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('reads shared-with-me rows from canonical ACL ids and resolves sharer identity', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const targetUserId = 'target-user';
        const sharerUserId = 'sharer-user';
        const now = Date.now();
        const noteId = crypto.randomUUID();
        const folderId = crypto.randomUUID();

        await adapter.execute(`INSERT INTO users (id, email) VALUES (?, ?)`, [
          sharerUserId,
          'sharer@example.com'
        ]);

        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [noteId, 'note', null, null, now]
        );
        await adapter.execute(`INSERT INTO notes (id, title) VALUES (?, ?)`, [
          noteId,
          'Shared Note'
        ]);
        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [folderId, 'folder', null, 'Shared Folder', now + 1]
        );

        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'share:shared-with-me-note',
            noteId,
            'user',
            targetUserId,
            'write',
            sharerUserId,
            now,
            now
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'share:shared-with-me-folder',
            folderId,
            'user',
            targetUserId,
            'read',
            null,
            now + 1,
            now + 1
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            'share:not-a-user-principal',
            noteId,
            'group',
            targetUserId,
            'read',
            sharerUserId,
            now + 2,
            now + 2
          ]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'share:revoked-shared-with-me',
            folderId,
            'user',
            targetUserId,
            'write',
            sharerUserId,
            now + 3,
            now + 3,
            now + 3
          ]
        );

        const rows = await querySharedWithMe(db, targetUserId, {
          column: null,
          direction: null
        });

        expect(rows).toHaveLength(2);

        const noteRow = rows.find(
          (row) => row.shareId === 'shared-with-me-note'
        );
        const folderRow = rows.find(
          (row) => row.shareId === 'shared-with-me-folder'
        );

        expect(noteRow?.name).toBe('Untitled Note');
        expect(noteRow?.sharedById).toBe(sharerUserId);
        expect(noteRow?.sharedByEmail).toBe('sharer@example.com');
        expect(noteRow?.permissionLevel).toBe('edit');

        expect(folderRow?.name).toBe('Shared Folder');
        expect(folderRow?.sharedById).toBe('unknown');
        expect(folderRow?.sharedByEmail).toBe('Unknown');
        expect(folderRow?.permissionLevel).toBe('view');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });

  it('includes policy-derived ACL rows in shared-by-me and shared-with-me', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const ownerId = 'policy-owner';
        const ownerEmail = 'owner@example.com';
        const targetUserId = 'policy-target';
        const now = Date.now();
        const folderId = crypto.randomUUID();
        const policyAclId = `policy-compiled:user:${targetUserId}:${folderId}`;

        await adapter.execute(
          `INSERT INTO users (id, email) VALUES (?, ?), (?, ?)`,
          [ownerId, ownerEmail, targetUserId, 'target@example.com']
        );
        await adapter.execute(
          `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [folderId, 'folder', ownerId, 'Policy Shared Folder', now]
        );
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [policyAclId, folderId, 'user', targetUserId, 'write', null, now, now]
        );

        const sharedByMe = await querySharedByMe(db, ownerId, {
          column: null,
          direction: null
        });
        expect(sharedByMe).toHaveLength(1);
        expect(sharedByMe[0]?.id).toBe(folderId);
        expect(sharedByMe[0]?.shareId).toBe(policyAclId);
        expect(sharedByMe[0]?.targetId).toBe(targetUserId);
        expect(sharedByMe[0]?.permissionLevel).toBe('edit');

        const sharedWithMe = await querySharedWithMe(db, targetUserId, {
          column: null,
          direction: null
        });
        expect(sharedWithMe).toHaveLength(1);
        expect(sharedWithMe[0]?.id).toBe(folderId);
        expect(sharedWithMe[0]?.shareId).toBe(policyAclId);
        expect(sharedWithMe[0]?.sharedById).toBe(ownerId);
        expect(sharedWithMe[0]?.sharedByEmail).toBe(ownerEmail);
        expect(sharedWithMe[0]?.permissionLevel).toBe('edit');
      },
      { migrations: vfsAclEnabledMigrations }
    );
  });
});
