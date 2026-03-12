import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  pullRemoteFeedsWithoutLocalHydration,
  queryLocalSharedByMe,
  queryLocalSharedWithMe,
  type RuntimeApiActor,
  teardownBrowserRuntimeActors
} from './browserRuntimeHarness.js';

function toGenericValue<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value));
}

describe('browserRuntimeHarness', () => {
  const actors: BrowserRuntimeActor[] = [];
  const getSyncPath = `${VFS_V2_CONNECT_BASE_PATH}/GetSync`;
  const getCrdtSyncPath = `${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`;

  afterEach(async () => {
    if (actors.length > 0) {
      await teardownBrowserRuntimeActors(actors.splice(0, actors.length));
    }
  });

  it('throws when sync feed reports hasMore without nextCursor', async () => {
    const actor: RuntimeApiActor = {
      fetchJson: async <T>(path: string) => {
        if (path.endsWith(getSyncPath)) {
          return toGenericValue<T>({
            json: JSON.stringify({
              items: [],
              hasMore: true,
              nextCursor: null
            })
          });
        }
        return toGenericValue<T>({
          json: JSON.stringify({
            items: [],
            hasMore: false,
            nextCursor: null
          })
        });
      }
    };

    await expect(
      pullRemoteFeedsWithoutLocalHydration({
        actor
      })
    ).rejects.toThrow('vfs sync feed reported hasMore without nextCursor');
  });

  it('throws when crdt feed reports hasMore without nextCursor', async () => {
    const actor: RuntimeApiActor = {
      fetchJson: async <T>(path: string) => {
        if (path.endsWith(getCrdtSyncPath)) {
          return toGenericValue<T>({
            json: JSON.stringify({
              items: [],
              hasMore: true,
              nextCursor: null
            })
          });
        }
        return toGenericValue<T>({
          json: JSON.stringify({
            items: [],
            hasMore: false,
            nextCursor: null
          })
        });
      }
    };

    await expect(
      pullRemoteFeedsWithoutLocalHydration({
        actor
      })
    ).rejects.toThrow('vfs crdt feed reported hasMore without nextCursor');
  });

  it('returns policy-derived ACL rows in local shared queries', async () => {
    const runtimeActor = await createBrowserRuntimeActor('harness-test');
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
        '00000000-0000-0000-0000-000000000003',
        'folder',
        '00000000-0000-0000-0000-000000000001',
        null,
        now
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'compiled:user:00000000-0000-0000-0000-000000000002:00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000003',
        'user',
        '00000000-0000-0000-0000-000000000002',
        'write',
        null,
        now,
        now
      ]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'compiled:user:00000000-0000-0000-0000-000000000001:00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000003',
        'user',
        '00000000-0000-0000-0000-000000000001',
        'write',
        null,
        now,
        now
      ]
    );

    const sharedByMe = await queryLocalSharedByMe(
      runtimeActor.localDb,
      '00000000-0000-0000-0000-000000000001'
    );
    expect(sharedByMe).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000003',
        shareId:
          'compiled:user:00000000-0000-0000-0000-000000000002:00000000-0000-0000-0000-000000000003',
        targetId: '00000000-0000-0000-0000-000000000002',
        permissionLevel: 'edit'
      }
    ]);

    const sharedWithMe = await queryLocalSharedWithMe(
      runtimeActor.localDb,
      '00000000-0000-0000-0000-000000000002'
    );
    expect(sharedWithMe).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000003',
        shareId:
          'compiled:user:00000000-0000-0000-0000-000000000002:00000000-0000-0000-0000-000000000003',
        sharedById: '00000000-0000-0000-0000-000000000001',
        sharedByEmail: 'owner@example.com'
      }
    ]);
  });
});
