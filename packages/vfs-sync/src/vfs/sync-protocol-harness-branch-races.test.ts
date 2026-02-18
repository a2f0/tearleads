import { describe, expect, it } from 'vitest';
import {
  activeChildrenForParent,
  InMemoryCrdtServerHarness,
  InMemoryReplicaHarness
} from './sync-protocol-harness-test-support.js';

describe('sync protocol harness', () => {
  it('converges branch-delete plus child-create races to a tombstoned subtree', async () => {
    const server = new InMemoryCrdtServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 5,
        operation: {
          opId: 'desktop-30',
          opType: 'link_add',
          itemId: 'folder-22',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T05:00:00.000Z',
          parentId: 'root',
          childId: 'folder-22'
        }
      },
      {
        delayMs: 8,
        operation: {
          opId: 'desktop-31',
          opType: 'link_add',
          itemId: 'item-old',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T05:00:01.000Z',
          parentId: 'folder-22',
          childId: 'item-old'
        }
      },
      {
        delayMs: 6,
        operation: {
          opId: 'mobile-30',
          opType: 'link_remove',
          itemId: 'folder-22',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T05:00:02.000Z',
          parentId: 'root',
          childId: 'folder-22'
        }
      },
      {
        delayMs: 4,
        operation: {
          opId: 'tablet-30',
          opType: 'link_add',
          itemId: 'item-new',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T05:00:03.000Z',
          parentId: 'folder-22',
          childId: 'item-new'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'mobile-31',
          opType: 'link_remove',
          itemId: 'item-old',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T05:00:04.000Z',
          parentId: 'folder-22',
          childId: 'item-old'
        }
      },
      {
        delayMs: 12,
        operation: {
          opId: 'mobile-32',
          opType: 'link_remove',
          itemId: 'item-new',
          replicaId: 'mobile',
          writeId: 3,
          occurredAt: '2026-02-14T05:00:05.000Z',
          parentId: 'folder-22',
          childId: 'item-new'
        }
      }
    ]);

    const serverSnapshot = server.snapshot();
    const feedItems = server.feed();

    const boundaryReplica = new InMemoryReplicaHarness();
    const pageSize = 2;
    for (let index = 0; index < feedItems.length; index += pageSize) {
      boundaryReplica.applyPage(feedItems.slice(index, index + pageSize));
      const pageNumber = index / pageSize;
      const snapshot = boundaryReplica.snapshot();

      /**
       * Guardrail: replay must converge deterministically even if an intermediate
       * page shows a detached subtree. The final page must still tombstone every
       * child edge created under the deleted branch before reconcile ACK persists.
       */
      if (pageNumber === 0) {
        expect(activeChildrenForParent(snapshot, 'root')).toEqual([
          'folder-22'
        ]);
        expect(activeChildrenForParent(snapshot, 'folder-22')).toEqual([
          'item-old'
        ]);
      }

      if (pageNumber === 1) {
        expect(activeChildrenForParent(snapshot, 'root')).toEqual([]);
        expect(activeChildrenForParent(snapshot, 'folder-22')).toEqual([
          'item-new',
          'item-old'
        ]);
      }

      if (pageNumber === 2) {
        expect(activeChildrenForParent(snapshot, 'root')).toEqual([]);
        expect(activeChildrenForParent(snapshot, 'folder-22')).toEqual([]);
      }
    }

    const desktopReplica = new InMemoryReplicaHarness();
    const mobileReplica = new InMemoryReplicaHarness();
    const tabletReplica = new InMemoryReplicaHarness();
    await Promise.all([
      desktopReplica.syncWithPageSize(feedItems, 1, 4),
      mobileReplica.syncWithPageSize(feedItems, 2, 6),
      tabletReplica.syncWithPageSize(feedItems, 3, 8)
    ]);

    const expectedCursor = {
      changedAt: '2026-02-14T05:00:05.000Z',
      changeId: 'mobile-32'
    };

    expect(serverSnapshot).toEqual({
      acl: [],
      links: [],
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 3,
        tablet: 1
      }
    });
    expect(boundaryReplica.snapshot()).toEqual({
      acl: [],
      links: [],
      cursor: expectedCursor
    });
    expect(desktopReplica.snapshot()).toEqual({
      acl: [],
      links: [],
      cursor: expectedCursor
    });
    expect(mobileReplica.snapshot()).toEqual({
      acl: [],
      links: [],
      cursor: expectedCursor
    });
    expect(tabletReplica.snapshot()).toEqual({
      acl: [],
      links: [],
      cursor: expectedCursor
    });
  });

  it('fails closed when a stale page arrives and recovers with forward-only pages', () => {
    const replica = new InMemoryReplicaHarness();

    replica.applyPage([
      {
        opId: 'op-2',
        itemId: 'item-9',
        opType: 'acl_add',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        parentId: null,
        childId: null,
        actorId: null,
        sourceTable: 'test',
        sourceId: 'op-2',
        occurredAt: '2026-02-14T03:00:01.000Z'
      }
    ]);

    expect(() =>
      replica.applyPage([
        {
          opId: 'op-1',
          itemId: 'item-9',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'write',
          parentId: null,
          childId: null,
          actorId: null,
          sourceTable: 'test',
          sourceId: 'op-1',
          occurredAt: '2026-02-14T03:00:00.000Z'
        }
      ])
    ).toThrowError(/not strictly newer than local cursor/);

    replica.applyPage([
      {
        opId: 'op-3',
        itemId: 'item-9',
        opType: 'acl_remove',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: null,
        parentId: null,
        childId: null,
        actorId: null,
        sourceTable: 'test',
        sourceId: 'op-3',
        occurredAt: '2026-02-14T03:00:02.000Z'
      }
    ]);

    expect(replica.snapshot()).toEqual({
      acl: [],
      links: [],
      cursor: {
        changedAt: '2026-02-14T03:00:02.000Z',
        changeId: 'op-3'
      }
    });
  });
});
