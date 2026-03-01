import '../test/setupIntegration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbModule from '@/db';
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

  it('ignores acl_add rows with missing access level', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-3',
          itemId: 'item-3',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:02:00.000Z',
          objectType: 'folder',
          ownerId: 'alice-id',
          createdAt: '2026-03-01T00:02:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-3',
          itemId: 'item-3',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'bob-id',
          accessLevel: null,
          parentId: null,
          childId: null,
          actorId: 'alice-id',
          sourceTable: 'vfs_acl_entries',
          sourceId: 'share:missing-access-level',
          occurredAt: '2026-03-01T00:02:01.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const aclRows = await adapter.execute(
      `SELECT id FROM vfs_acl_entries WHERE item_id = ?`,
      ['item-3']
    );
    expect(aclRows.rows).toHaveLength(0);
  });

  it('returns early when database is not initialized', async () => {
    const isDatabaseInitializedSpy = vi
      .spyOn(dbModule, 'isDatabaseInitialized')
      .mockReturnValue(false);

    await hydrateLocalReadModelFromRemoteFeeds();

    expect(mockGetSync).not.toHaveBeenCalled();
    expect(mockGetCrdtSync).not.toHaveBeenCalled();
    isDatabaseInitializedSpy.mockRestore();
  });

  it('hydrates across paginated feeds and ignores non-ACL CRDT ops', async () => {
    mockGetSync
      .mockResolvedValueOnce({
        items: [
          {
            changeId: 'sync-10',
            itemId: 'item-10',
            changeType: 'upsert',
            changedAt: '2026-03-01T00:03:00.000Z',
            objectType: 'folder',
            ownerId: 'alice-id',
            createdAt: '2026-03-01T00:03:00.000Z',
            accessLevel: 'admin'
          }
        ],
        nextCursor: 'sync-cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [
          {
            changeId: 'sync-11',
            itemId: 'item-11',
            changeType: 'upsert',
            changedAt: '2026-03-01T00:03:01.000Z',
            objectType: 'folder',
            ownerId: 'alice-id',
            createdAt: '2026-03-01T00:03:01.000Z',
            accessLevel: 'admin'
          }
        ],
        nextCursor: null,
        hasMore: false
      });
    mockGetCrdtSync
      .mockResolvedValueOnce({
        items: [
          {
            opId: 'crdt-10',
            itemId: 'item-10',
            opType: 'item_upsert',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: null,
            childId: null,
            actorId: 'alice-id',
            sourceTable: 'vfs_crdt_ops',
            sourceId: 'crdt-10',
            occurredAt: '2026-03-01T00:03:02.000Z'
          },
          {
            opId: 'crdt-11',
            itemId: 'item-10',
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'bob-id',
            accessLevel: 'read',
            parentId: null,
            childId: null,
            actorId: 'alice-id',
            sourceTable: 'vfs_acl_entries',
            sourceId: 'share:share-10',
            occurredAt: '2026-03-01T00:03:03.000Z'
          }
        ],
        nextCursor: 'crdt-cursor-1',
        hasMore: true,
        lastReconciledWriteIds: {}
      })
      .mockResolvedValueOnce({
        items: [
          {
            opId: 'crdt-12',
            itemId: 'item-11',
            opType: 'acl_add',
            principalType: null,
            principalId: 'bob-id',
            accessLevel: 'read',
            parentId: null,
            childId: null,
            actorId: 'alice-id',
            sourceTable: 'vfs_acl_entries',
            sourceId: 'share:share-11',
            occurredAt: '2026-03-01T00:03:04.000Z'
          }
        ],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: {}
      });

    await hydrateLocalReadModelFromRemoteFeeds();

    expect(mockGetSync).toHaveBeenNthCalledWith(1, undefined, 500);
    expect(mockGetSync).toHaveBeenNthCalledWith(2, 'sync-cursor-1', 500);
    expect(mockGetCrdtSync).toHaveBeenNthCalledWith(1, undefined, 500);
    expect(mockGetCrdtSync).toHaveBeenNthCalledWith(2, 'crdt-cursor-1', 500);

    const adapter = getDatabaseAdapter();
    const registryRows = await adapter.execute(
      `SELECT id FROM vfs_registry WHERE id IN (?, ?) ORDER BY id`,
      ['item-10', 'item-11']
    );
    expect(registryRows.rows).toHaveLength(2);

    const aclRows = await adapter.execute(
      `SELECT id FROM vfs_acl_entries WHERE item_id IN (?, ?) ORDER BY id`,
      ['item-10', 'item-11']
    );
    expect(aclRows.rows).toEqual([
      expect.objectContaining({ id: 'share:share-10' })
    ]);
  });

  it('skips ACL rows whose registry item is deleted in sync feed', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-del-1',
          itemId: 'item-deleted',
          changeType: 'delete',
          changedAt: '2026-03-01T00:04:00.000Z',
          objectType: null,
          ownerId: null,
          createdAt: null,
          accessLevel: 'read'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-del-1',
          itemId: 'item-deleted',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'bob-id',
          accessLevel: 'read',
          parentId: null,
          childId: null,
          actorId: 'alice-id',
          sourceTable: 'vfs_acl_entries',
          sourceId: 'share:deleted-item-share',
          occurredAt: '2026-03-01T00:04:01.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const aclRows = await adapter.execute(
      `SELECT id FROM vfs_acl_entries WHERE item_id = ?`,
      ['item-deleted']
    );
    expect(aclRows.rows).toHaveLength(0);
  });

  it('throws when sync feed cursor does not advance', async () => {
    mockGetSync
      .mockResolvedValueOnce({
        items: [],
        nextCursor: 'stuck-cursor',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [],
        nextCursor: 'stuck-cursor',
        hasMore: true
      });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(hydrateLocalReadModelFromRemoteFeeds()).rejects.toThrow(
      'vfs sync feed returned a non-advancing cursor: stuck-cursor'
    );
  });

  it('re-enables foreign keys when transaction begin fails', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    const adapter = getDatabaseAdapter();
    const originalExecute = adapter.execute.bind(adapter);
    const executeSpy = vi
      .spyOn(adapter, 'execute')
      .mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql === 'BEGIN') {
          throw new Error('begin failed');
        }
        return originalExecute(sql, params);
      });

    await expect(hydrateLocalReadModelFromRemoteFeeds()).rejects.toThrow(
      'begin failed'
    );

    expect(
      executeSpy.mock.calls.some(([sql]) => sql === 'PRAGMA foreign_keys = ON')
    ).toBe(true);
    executeSpy.mockRestore();
  });
});
