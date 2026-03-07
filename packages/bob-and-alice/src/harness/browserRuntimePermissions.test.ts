import { afterEach, describe, expect, it } from 'vitest';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  teardownBrowserRuntimeActors
} from './browserRuntimeHarness.js';
import { queryLocalItemPermission } from './browserRuntimePermissions.js';

describe('browserRuntimePermissions', () => {
  const actors: BrowserRuntimeActor[] = [];

  afterEach(async () => {
    if (actors.length > 0) {
      await teardownBrowserRuntimeActors(actors.splice(0, actors.length));
    }
  });

  it('maps read ACL to view-only permission', async () => {
    const runtimeActor = await createBrowserRuntimeActor('permissions-read');
    actors.push(runtimeActor);
    const { adapter } = runtimeActor.localDb;
    const now = Date.now();

    await adapter.execute(
      `INSERT INTO users (id, email) VALUES (?, ?), (?, ?)`,
      ['owner-id', 'owner@example.com', 'target-id', 'target@example.com']
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['note-1', 'note', 'owner-id', 'encrypted-note', now]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'share:read',
        'note-1',
        'user',
        'target-id',
        'read',
        'owner-id',
        now,
        now
      ]
    );

    const permission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: 'note-1',
      currentUserId: 'target-id',
      nowMillis: now
    });

    expect(permission).toEqual({
      itemId: 'note-1',
      currentUserId: 'target-id',
      exists: true,
      isOwner: false,
      accessRank: 1,
      permissionLevel: 'view',
      canRead: true,
      canEdit: false
    });
  });

  it('maps write/admin ACL to edit permission and owner to owner permission', async () => {
    const runtimeActor = await createBrowserRuntimeActor('permissions-write');
    actors.push(runtimeActor);
    const { adapter } = runtimeActor.localDb;
    const now = Date.now();

    await adapter.execute(
      `INSERT INTO users (id, email) VALUES (?, ?), (?, ?), (?, ?)`,
      [
        'owner-id',
        'owner@example.com',
        'target-id',
        'target@example.com',
        'admin-id',
        'admin@example.com'
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['note-2', 'note', 'owner-id', 'encrypted-note', now]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, NULL),
         (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'share:write',
        'note-2',
        'user',
        'target-id',
        'write',
        'owner-id',
        now,
        now,
        'share:admin',
        'note-2',
        'user',
        'admin-id',
        'admin',
        'owner-id',
        now,
        now
      ]
    );

    const writePermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: 'note-2',
      currentUserId: 'target-id',
      nowMillis: now
    });
    expect(writePermission.permissionLevel).toBe('edit');
    expect(writePermission.accessRank).toBe(2);
    expect(writePermission.canEdit).toBe(true);

    const adminPermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: 'note-2',
      currentUserId: 'admin-id',
      nowMillis: now
    });
    expect(adminPermission.permissionLevel).toBe('edit');
    expect(adminPermission.accessRank).toBe(3);
    expect(adminPermission.canEdit).toBe(true);

    const ownerPermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: 'note-2',
      currentUserId: 'owner-id',
      nowMillis: now
    });
    expect(ownerPermission.permissionLevel).toBe('owner');
    expect(ownerPermission.isOwner).toBe(true);
    expect(ownerPermission.accessRank).toBe(3);
  });

  it('ignores revoked and expired ACL rows', async () => {
    const runtimeActor = await createBrowserRuntimeActor('permissions-expired');
    actors.push(runtimeActor);
    const { adapter } = runtimeActor.localDb;
    const now = Date.now();

    await adapter.execute(
      `INSERT INTO users (id, email) VALUES (?, ?), (?, ?)`,
      ['owner-id', 'owner@example.com', 'target-id', 'target@example.com']
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['note-3', 'note', 'owner-id', 'encrypted-note', now]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, expires_at, revoked_at
       ) VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL),
         (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        'share:expired',
        'note-3',
        'user',
        'target-id',
        'write',
        'owner-id',
        now,
        now,
        now - 1,
        'share:revoked',
        'note-3',
        'user',
        'target-id',
        'admin',
        'owner-id',
        now,
        now,
        now - 1
      ]
    );

    const permission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: 'note-3',
      currentUserId: 'target-id',
      nowMillis: now
    });

    expect(permission.permissionLevel).toBe('none');
    expect(permission.accessRank).toBe(0);
    expect(permission.canRead).toBe(false);
    expect(permission.canEdit).toBe(false);
  });
});
