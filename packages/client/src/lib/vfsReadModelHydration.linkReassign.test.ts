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

describe('vfsReadModelHydration link_reassign', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('removes prior parent link and creates new one', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'sync-ra-1',
          itemId: 'container-a',
          changeType: 'upsert',
          changedAt: '2026-03-02T00:00:01.000Z',
          objectType: 'folder',
          ownerId: 'alice-id',
          createdAt: '2026-03-02T00:00:00.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'sync-ra-2',
          itemId: 'container-b',
          changeType: 'upsert',
          changedAt: '2026-03-02T00:00:02.000Z',
          objectType: 'folder',
          ownerId: 'alice-id',
          createdAt: '2026-03-02T00:00:00.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'sync-ra-3',
          itemId: 'reading-x',
          changeType: 'upsert',
          changedAt: '2026-03-02T00:00:03.000Z',
          objectType: 'healthReading',
          ownerId: 'alice-id',
          createdAt: '2026-03-02T00:00:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'crdt-ra-1',
          itemId: 'reading-x',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'container-a',
          childId: 'reading-x',
          actorId: 'alice-id',
          sourceTable: 'vfs_links',
          sourceId: 'link-ra-1',
          occurredAt: '2026-03-02T00:00:04.000Z'
        },
        {
          opId: 'crdt-ra-2',
          itemId: 'reading-x',
          opType: 'link_reassign',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'container-b',
          childId: 'reading-x',
          actorId: 'alice-id',
          sourceTable: 'vfs_links',
          sourceId: 'link-ra-2',
          occurredAt: '2026-03-02T00:00:05.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await hydrateLocalReadModelFromRemoteFeeds();

    const adapter = getDatabaseAdapter();
    const linkRows = await adapter.execute(
      `SELECT parent_id, child_id FROM vfs_links WHERE child_id = ?`,
      ['reading-x']
    );
    expect(linkRows.rows).toEqual([
      expect.objectContaining({
        parent_id: 'container-b',
        child_id: 'reading-x'
      })
    ]);
  });
});
