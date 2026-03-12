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
      [
        '00000000-0000-0000-0000-000000000001',
        'owner@example.com',
        '00000000-0000-0000-0000-000000000002',
        'target@example.com'
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        '1',
        'note',
        '00000000-0000-0000-0000-000000000001',
        'encrypted-note',
        now
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'read',
        '1',
        'user',
        '00000000-0000-0000-0000-000000000002',
        'read',
        '00000000-0000-0000-0000-000000000001',
        now,
        now
      ]
    );

    const permission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: '1',
      currentUserId: '00000000-0000-0000-0000-000000000002',
      nowMillis: now
    });

    expect(permission).toEqual({
      itemId: '1',
      currentUserId: '00000000-0000-0000-0000-000000000002',
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
        '00000000-0000-0000-0000-000000000001',
        'owner@example.com',
        '00000000-0000-0000-0000-000000000002',
        'target@example.com',
        'admin-id',
        'admin@example.com'
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        '2',
        'note',
        '00000000-0000-0000-0000-000000000001',
        'encrypted-note',
        now
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, NULL),
         (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'write',
        '2',
        'user',
        '00000000-0000-0000-0000-000000000002',
        'write',
        '00000000-0000-0000-0000-000000000001',
        now,
        now,
        'admin',
        '2',
        'user',
        'admin-id',
        'admin',
        '00000000-0000-0000-0000-000000000001',
        now,
        now
      ]
    );

    const writePermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: '2',
      currentUserId: '00000000-0000-0000-0000-000000000002',
      nowMillis: now
    });
    expect(writePermission.permissionLevel).toBe('edit');
    expect(writePermission.accessRank).toBe(2);
    expect(writePermission.canEdit).toBe(true);

    const adminPermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: '2',
      currentUserId: 'admin-id',
      nowMillis: now
    });
    expect(adminPermission.permissionLevel).toBe('edit');
    expect(adminPermission.accessRank).toBe(3);
    expect(adminPermission.canEdit).toBe(true);

    const ownerPermission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: '2',
      currentUserId: '00000000-0000-0000-0000-000000000001',
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
      [
        '00000000-0000-0000-0000-000000000001',
        'owner@example.com',
        '00000000-0000-0000-0000-000000000002',
        'target@example.com'
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        '3',
        'note',
        '00000000-0000-0000-0000-000000000001',
        'encrypted-note',
        now
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, expires_at, revoked_at
       ) VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL),
         (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        'expired',
        '3',
        'user',
        '00000000-0000-0000-0000-000000000002',
        'write',
        '00000000-0000-0000-0000-000000000001',
        now,
        now,
        now - 1,
        'revoked',
        '3',
        'user',
        '00000000-0000-0000-0000-000000000002',
        'admin',
        '00000000-0000-0000-0000-000000000001',
        now,
        now,
        now - 1
      ]
    );

    const permission = await queryLocalItemPermission({
      localDb: runtimeActor.localDb,
      itemId: '3',
      currentUserId: '00000000-0000-0000-0000-000000000002',
      nowMillis: now
    });

    expect(permission.permissionLevel).toBe('none');
    expect(permission.accessRank).toBe(0);
    expect(permission.canRead).toBe(false);
    expect(permission.canEdit).toBe(false);
  });
});
