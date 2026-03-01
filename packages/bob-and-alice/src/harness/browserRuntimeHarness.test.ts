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

describe('browserRuntimeHarness', () => {
  const actors: BrowserRuntimeActor[] = [];

  afterEach(async () => {
    if (actors.length > 0) {
      await teardownBrowserRuntimeActors(actors.splice(0, actors.length));
    }
  });

  it('throws when sync feed reports hasMore without nextCursor', async () => {
    const actor: RuntimeApiActor = {
      fetchJson: async (path: string) => {
        if (path.startsWith('/vfs/vfs-sync?')) {
          return JSON.parse(
            JSON.stringify({
              items: [],
              hasMore: true,
              nextCursor: null
            })
          );
        }
        return JSON.parse(
          JSON.stringify({
            items: [],
            hasMore: false,
            nextCursor: null
          })
        );
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
      fetchJson: async (path: string) => {
        if (path.startsWith('/vfs/crdt/vfs-sync?')) {
          return JSON.parse(
            JSON.stringify({
              items: [],
              hasMore: true,
              nextCursor: null
            })
          );
        }
        return JSON.parse(
          JSON.stringify({
            items: [],
            hasMore: false,
            nextCursor: null
          })
        );
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
      ['owner-id', 'owner@example.com', 'target-id', 'target@example.com']
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['item-1', 'folder', 'owner-id', null, now]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'policy-compiled:user:target-id:item-1',
        'item-1',
        'user',
        'target-id',
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
        'policy-compiled:user:owner-id:item-1',
        'item-1',
        'user',
        'owner-id',
        'write',
        null,
        now,
        now
      ]
    );

    const sharedByMe = await queryLocalSharedByMe(
      runtimeActor.localDb,
      'owner-id'
    );
    expect(sharedByMe).toEqual([
      {
        id: 'item-1',
        shareId: 'policy-compiled:user:target-id:item-1',
        targetId: 'target-id',
        permissionLevel: 'edit'
      }
    ]);

    const sharedWithMe = await queryLocalSharedWithMe(
      runtimeActor.localDb,
      'target-id'
    );
    expect(sharedWithMe).toEqual([
      {
        id: 'item-1',
        shareId: 'policy-compiled:user:target-id:item-1',
        sharedById: 'owner-id',
        sharedByEmail: 'owner@example.com'
      }
    ]);
  });
});
