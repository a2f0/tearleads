import '../test/setupIntegration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from '@/db';
import { hydrateLocalReadModelFromRemoteFeeds } from './vfsReadModelHydration';

const mockGetSync = vi.fn();
const mockGetCrdtSync = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getSync: (...args: unknown[]) => mockGetSync(...args),
      getCrdtSync: (...args: unknown[]) => mockGetCrdtSync(...args)
    }
  }
}));

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vfsReadModelHydration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('hydrates registry and ACL rows from remote feeds', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-1',
          itemId: 'item-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:00:01.000Z',
          objectType: 'folder',
          ownerId: 'alice-id',
          createdAt: '2026-03-01T00:00:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-1',
          itemId: 'item-1',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'bob-id',
          accessLevel: 'read',
          parentId: null,
          childId: null,
          actorId: 'alice-id',
          sourceTable: 'vfs_acl_entries',
          sourceId: 'share:share-1',
          occurredAt: '2026-03-01T00:00:02.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const registryRows = await adapter.execute(
      `SELECT id, object_type, owner_id FROM vfs_registry WHERE id = ?`,
      ['item-1']
    );
    expect(registryRows.rows).toEqual([
      expect.objectContaining({
        id: 'item-1',
        object_type: 'folder',
        owner_id: 'alice-id'
      })
    ]);

    const aclRows = await adapter.execute(
      `SELECT id, item_id, principal_type, principal_id, access_level, granted_by
       FROM vfs_acl_entries WHERE item_id = ?`,
      ['item-1']
    );
    expect(aclRows.rows).toEqual([
      expect.objectContaining({
        id: 'share:share-1',
        item_id: 'item-1',
        principal_type: 'user',
        principal_id: 'bob-id',
        access_level: 'read',
        granted_by: 'alice-id'
      })
    ]);
  });

  it('applies delete and acl_remove convergence from later feed pages', async () => {
    const adapter = getDatabaseAdapter();
    await adapter.execute(
      `INSERT INTO users (id, email) VALUES (?, ?), (?, ?)`,
      ['alice-id', 'alice@example.com', 'bob-id', 'bob@example.com']
    );
    await adapter.execute(
      `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['item-2', 'folder', 'alice-id', null, Date.now()]
    );
    await adapter.execute(
      `INSERT INTO vfs_acl_entries (
         id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        'share:stale',
        'item-2',
        'user',
        'bob-id',
        'write',
        'alice-id',
        Date.now(),
        Date.now()
      ]
    );

    mockGetSync
      .mockResolvedValueOnce({
        items: [
          {
            changeId: 'sync-1',
            itemId: 'item-2',
            changeType: 'delete',
            changedAt: '2026-03-01T00:01:00.000Z',
            objectType: null,
            ownerId: null,
            createdAt: null,
            accessLevel: 'read'
          }
        ],
        nextCursor: null,
        hasMore: false
      })
      .mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false
      });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-2',
          itemId: 'item-2',
          opType: 'acl_remove',
          principalType: 'user',
          principalId: 'bob-id',
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'alice-id',
          sourceTable: 'vfs_acl_entries',
          sourceId: 'share:stale',
          occurredAt: '2026-03-01T00:01:01.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const registryRows = await adapter.execute(
      `SELECT id FROM vfs_registry WHERE id = ?`,
      ['item-2']
    );
    expect(registryRows.rows).toHaveLength(0);

    const aclRows = await adapter.execute(
      `SELECT id FROM vfs_acl_entries WHERE item_id = ?`,
      ['item-2']
    );
    expect(aclRows.rows).toHaveLength(0);
  });
});
