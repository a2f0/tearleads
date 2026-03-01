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

describe('vfsReadModelHydration refresh regressions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('throws when sync feed reports hasMore without nextCursor', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: true
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(hydrateLocalReadModelFromRemoteFeeds()).rejects.toThrow(
      'vfs sync feed reported hasMore without nextCursor'
    );
  });

  it('hydrates policy-derived ACL entries for shared views', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-policy-1',
          itemId: 'item-policy-1',
          changeType: 'upsert',
          changedAt: '2026-03-01T00:05:00.000Z',
          objectType: 'folder',
          ownerId: 'alice-id',
          createdAt: '2026-03-01T00:05:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-policy-1',
          itemId: 'item-policy-1',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'bob-id',
          accessLevel: 'read',
          parentId: null,
          childId: null,
          actorId: null,
          sourceTable: 'vfs_acl_entries',
          sourceId: 'policy-compiled:user:bob-id:item-policy-1',
          occurredAt: '2026-03-01T00:05:01.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const aclRows = await adapter.execute(
      `SELECT id, item_id, principal_type, principal_id, access_level
       FROM vfs_acl_entries
       WHERE item_id = ?`,
      ['item-policy-1']
    );
    expect(aclRows.rows).toEqual([
      expect.objectContaining({
        id: 'policy-compiled:user:bob-id:item-policy-1',
        item_id: 'item-policy-1',
        principal_type: 'user',
        principal_id: 'bob-id',
        access_level: 'read'
      })
    ]);
  });
});
