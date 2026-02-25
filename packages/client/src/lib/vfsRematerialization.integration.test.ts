import '../test/setupIntegration';

import { vfsAclEntries, vfsItemState, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, getDatabaseAdapter, resetDatabase, setupDatabase } from '@/db';
import { rematerializeRemoteVfsStateIfNeeded } from './vfsRematerialization';

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

async function hasTable(name: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name]
  );
  return result.rows.length > 0;
}

describe('vfsRematerialization integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
  });

  it('rebuilds canonical VFS tables from remote sync feeds when local registry is empty', async () => {
    mockGetSync
      .mockResolvedValueOnce({
        items: [
          {
            changeId: 'change-1',
            itemId: 'root-item',
            changeType: 'upsert',
            changedAt: '2026-01-01T00:00:01.000Z',
            objectType: 'folder',
            ownerId: 'user-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            accessLevel: 'admin'
          },
          {
            changeId: 'change-2',
            itemId: 'child-item',
            changeType: 'upsert',
            changedAt: '2026-01-01T00:00:02.000Z',
            objectType: 'note',
            ownerId: 'user-1',
            createdAt: '2026-01-01T00:00:02.000Z',
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
            opId: 'op-1',
            itemId: 'root-item',
            opType: 'item_upsert',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: null,
            childId: null,
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-1',
            occurredAt: '2026-01-01T00:00:01.100Z',
            encryptedPayload: 'enc-root',
            keyEpoch: 1
          },
          {
            opId: 'op-2',
            itemId: 'child-item',
            opType: 'item_upsert',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: null,
            childId: null,
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-2',
            occurredAt: '2026-01-01T00:00:02.100Z',
            encryptedPayload: 'enc-child',
            keyEpoch: 2
          },
          {
            opId: 'op-3',
            itemId: 'child-item',
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'user-1',
            accessLevel: 'admin',
            parentId: null,
            childId: null,
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-3',
            occurredAt: '2026-01-01T00:00:02.200Z'
          },
          {
            opId: 'op-4',
            itemId: 'child-item',
            opType: 'link_add',
            principalType: null,
            principalId: null,
            accessLevel: null,
            parentId: 'root-item',
            childId: 'child-item',
            actorId: 'user-1',
            sourceTable: 'vfs_crdt_client_push',
            sourceId: 'source-4',
            occurredAt: '2026-01-01T00:00:02.300Z'
          }
        ],
        nextCursor: null,
        hasMore: false,
        lastReconciledWriteIds: { 'user-1:client': 4 }
      });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

    const db = getDatabase();
    const registryRows = await db.select().from(vfsRegistry);
    const linkRows = await db.select().from(vfsLinks);

    expect(registryRows).toHaveLength(2);
    expect(linkRows).toEqual([
      expect.objectContaining({
        id: 'link:root-item:child-item',
        parentId: 'root-item',
        childId: 'child-item'
      })
    ]);
    if (await hasTable('vfs_acl_entries')) {
      const aclRows = await db.select().from(vfsAclEntries);
      expect(aclRows).toEqual([
        expect.objectContaining({
          id: 'acl:child-item:user:user-1',
          itemId: 'child-item',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'admin'
        })
      ]);
    }
    if (await hasTable('vfs_item_state')) {
      const itemStateRows = await db.select().from(vfsItemState);
      expect(itemStateRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            itemId: 'root-item',
            encryptedPayload: 'enc-root',
            keyEpoch: 1
          }),
          expect.objectContaining({
            itemId: 'child-item',
            encryptedPayload: 'enc-child',
            keyEpoch: 2
          })
        ])
      );
    }
  });

  it('skips rematerialization when local registry already contains data', async () => {
    const db = getDatabase();
    await db.insert(vfsRegistry).values({
      id: 'existing-item',
      objectType: 'folder',
      ownerId: null,
      encryptedSessionKey: null,
      encryptedName: null,
      icon: null,
      viewMode: null,
      defaultSort: null,
      sortDirection: null,
      publicHierarchicalKey: null,
      encryptedPrivateHierarchicalKey: null,
      createdAt: new Date(0)
    });

    await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(false);
    expect(mockGetSync).not.toHaveBeenCalled();
    expect(mockGetCrdtSync).not.toHaveBeenCalled();

    const row = await db
      .select()
      .from(vfsRegistry)
      .where(eq(vfsRegistry.id, 'existing-item'));
    expect(row).toHaveLength(1);
  });
});
