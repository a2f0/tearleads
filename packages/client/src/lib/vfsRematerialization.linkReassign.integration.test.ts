import '../test/setupIntegration';

import { vfsLinks } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase, setupDatabase } from '@/db';
import { rematerializeRemoteVfsStateIfNeeded } from './vfsRematerialization';

type LocalWriteCallback = () => Promise<void>;

const mockGetSync = vi.fn();
const mockGetCrdtSync = vi.fn();
const mockRunLocalWrite = vi.fn(
  async (callback: LocalWriteCallback): Promise<void> => callback()
);

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      getSync: (...args: unknown[]) => mockGetSync(...args),
      getCrdtSync: (...args: unknown[]) => mockGetCrdtSync(...args)
    }
  }
}));
vi.mock('@/db/localWrite', () => ({
  runLocalWrite: (callback: LocalWriteCallback) => mockRunLocalWrite(callback)
}));

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('vfsRematerialization link_reassign', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunLocalWrite.mockImplementation(
      async (callback: LocalWriteCallback): Promise<void> => callback()
    );
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('removes prior parent link and creates new one', async () => {
    mockGetSync.mockResolvedValueOnce({
      items: [
        {
          changeId: 'change-ra-1',
          itemId: 'parent-a',
          changeType: 'upsert',
          changedAt: '2026-01-04T00:00:01.000Z',
          objectType: 'folder',
          ownerId: 'user-1',
          createdAt: '2026-01-04T00:00:00.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-ra-2',
          itemId: 'parent-b',
          changeType: 'upsert',
          changedAt: '2026-01-04T00:00:02.000Z',
          objectType: 'folder',
          ownerId: 'user-1',
          createdAt: '2026-01-04T00:00:00.000Z',
          accessLevel: 'admin'
        },
        {
          changeId: 'change-ra-3',
          itemId: 'reading-1',
          changeType: 'upsert',
          changedAt: '2026-01-04T00:00:03.000Z',
          objectType: 'healthReading',
          ownerId: 'user-1',
          createdAt: '2026-01-04T00:00:00.000Z',
          accessLevel: 'admin'
        }
      ],
      nextCursor: null,
      hasMore: false
    });

    mockGetCrdtSync.mockResolvedValueOnce({
      items: [
        {
          opId: 'op-ra-1',
          itemId: 'reading-1',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'parent-a',
          childId: 'reading-1',
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-ra-1',
          occurredAt: '2026-01-04T00:00:04.000Z'
        },
        {
          opId: 'op-ra-2',
          itemId: 'reading-1',
          opType: 'link_reassign',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: 'parent-b',
          childId: 'reading-1',
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'source-ra-2',
          occurredAt: '2026-01-04T00:00:05.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

    const db = getDatabase();
    const linkRows = await db.select().from(vfsLinks);

    // Only parent-b link should remain; parent-a link was replaced
    expect(linkRows).toEqual([
      expect.objectContaining({
        id: 'link:parent-b:reading-1',
        parentId: 'parent-b',
        childId: 'reading-1'
      })
    ]);
  });
});
