import { describe, expect, it } from 'vitest';
import {
  activeParentsForChild,
  InMemoryCrdtServerHarness,
  InMemoryReplicaHarness
} from './sync-protocol-harness-test-support.js';

describe('sync protocol harness', () => {
  it('converges all replicas after concurrent server writes and paged sync', async () => {
    const server = new InMemoryCrdtServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 20,
        operation: {
          opId: 'desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T03:00:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      },
      {
        delayMs: 5,
        operation: {
          opId: 'mobile-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T03:00:01.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'desktop-2',
          opType: 'link_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T03:00:02.000Z',
          parentId: 'root',
          childId: 'item-1'
        }
      },
      {
        delayMs: 15,
        operation: {
          opId: 'mobile-2',
          opType: 'link_remove',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T03:00:03.000Z',
          parentId: 'root',
          childId: 'item-1'
        }
      },
      {
        delayMs: 25,
        operation: {
          opId: 'tablet-1',
          opType: 'link_add',
          itemId: 'item-1',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T03:00:04.000Z',
          parentId: 'root',
          childId: 'item-1'
        }
      }
    ]);

    const serverSnapshot = server.snapshot();
    const feedItems = server.feed();

    const desktopReplica = new InMemoryReplicaHarness();
    const mobileReplica = new InMemoryReplicaHarness();
    const tabletReplica = new InMemoryReplicaHarness();

    await Promise.all([
      desktopReplica.syncWithPageSize(feedItems, 1, 5),
      mobileReplica.syncWithPageSize(feedItems, 2, 10),
      tabletReplica.syncWithPageSize(feedItems, 3, 15)
    ]);

    expect(serverSnapshot).toEqual({
      acl: [
        {
          itemId: 'item-1',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write'
        }
      ],
      links: [
        {
          parentId: 'root',
          childId: 'item-1'
        }
      ],
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 2,
        tablet: 1
      }
    });

    const expectedCursor = {
      changedAt: '2026-02-14T03:00:04.000Z',
      changeId: 'tablet-1'
    };

    expect(desktopReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(mobileReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(tabletReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
  });

  it('converges concurrent reparent races without leaving orphan or multi-parent end state', async () => {
    const server = new InMemoryCrdtServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 5,
        operation: {
          opId: 'desktop-1',
          opType: 'link_add',
          itemId: 'item-7',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T03:10:00.000Z',
          parentId: 'root',
          childId: 'item-7'
        }
      },
      {
        delayMs: 8,
        operation: {
          opId: 'mobile-1',
          opType: 'link_remove',
          itemId: 'item-7',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T03:10:01.000Z',
          parentId: 'root',
          childId: 'item-7'
        }
      },
      {
        delayMs: 12,
        operation: {
          opId: 'mobile-2',
          opType: 'link_add',
          itemId: 'item-7',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T03:10:02.000Z',
          parentId: 'folder-mobile',
          childId: 'item-7'
        }
      },
      {
        delayMs: 16,
        operation: {
          opId: 'desktop-2',
          opType: 'link_remove',
          itemId: 'item-7',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T03:10:03.000Z',
          parentId: 'folder-mobile',
          childId: 'item-7'
        }
      },
      {
        delayMs: 20,
        operation: {
          opId: 'desktop-3',
          opType: 'link_add',
          itemId: 'item-7',
          replicaId: 'desktop',
          writeId: 3,
          occurredAt: '2026-02-14T03:10:04.000Z',
          parentId: 'folder-desktop',
          childId: 'item-7'
        }
      }
    ]);

    const serverSnapshot = server.snapshot();
    const feedItems = server.feed();

    const desktopReplica = new InMemoryReplicaHarness();
    const mobileReplica = new InMemoryReplicaHarness();
    const tabletReplica = new InMemoryReplicaHarness();

    await Promise.all([
      desktopReplica.syncWithPageSize(feedItems, 1, 5),
      mobileReplica.syncWithPageSize(feedItems, 2, 10),
      tabletReplica.syncWithPageSize(feedItems, 3, 15)
    ]);

    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 2
    });
    expect(activeParentsForChild(serverSnapshot, 'item-7')).toEqual([
      'folder-desktop'
    ]);

    const expectedCursor = {
      changedAt: '2026-02-14T03:10:04.000Z',
      changeId: 'desktop-3'
    };
    expect(desktopReplica.snapshot()).toEqual({
      acl: [],
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(mobileReplica.snapshot()).toEqual({
      acl: [],
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(tabletReplica.snapshot()).toEqual({
      acl: [],
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
  });

  it('preserves deterministic reparent plus revoke transitions across page boundaries', async () => {
    const server = new InMemoryCrdtServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 1,
        operation: {
          opId: 'desktop-20',
          opType: 'acl_add',
          itemId: 'item-11',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T04:20:00.000Z',
          principalType: 'group',
          principalId: 'group-11',
          accessLevel: 'read'
        }
      },
      {
        delayMs: 4,
        operation: {
          opId: 'mobile-20',
          opType: 'link_add',
          itemId: 'item-11',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T04:20:01.000Z',
          parentId: 'root',
          childId: 'item-11'
        }
      },
      {
        delayMs: 8,
        operation: {
          opId: 'tablet-20',
          opType: 'link_remove',
          itemId: 'item-11',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T04:20:02.000Z',
          parentId: 'root',
          childId: 'item-11'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'desktop-21',
          opType: 'link_add',
          itemId: 'item-11',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T04:20:03.000Z',
          parentId: 'folder-a',
          childId: 'item-11'
        }
      },
      {
        delayMs: 14,
        operation: {
          opId: 'mobile-21',
          opType: 'acl_remove',
          itemId: 'item-11',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T04:20:04.000Z',
          principalType: 'group',
          principalId: 'group-11'
        }
      },
      {
        delayMs: 13,
        operation: {
          opId: 'tablet-21',
          opType: 'link_remove',
          itemId: 'item-11',
          replicaId: 'tablet',
          writeId: 2,
          occurredAt: '2026-02-14T04:20:05.000Z',
          parentId: 'folder-a',
          childId: 'item-11'
        }
      },
      {
        delayMs: 15,
        operation: {
          opId: 'desktop-22',
          opType: 'link_add',
          itemId: 'item-11',
          replicaId: 'desktop',
          writeId: 3,
          occurredAt: '2026-02-14T04:20:06.000Z',
          parentId: 'folder-b',
          childId: 'item-11'
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

      if (pageNumber === 0) {
        expect(snapshot.acl).toEqual([
          {
            itemId: 'item-11',
            principalType: 'group',
            principalId: 'group-11',
            accessLevel: 'read'
          }
        ]);
        expect(activeParentsForChild(snapshot, 'item-11')).toEqual(['root']);
      }

      if (pageNumber === 1) {
        expect(snapshot.acl).toEqual([
          {
            itemId: 'item-11',
            principalType: 'group',
            principalId: 'group-11',
            accessLevel: 'read'
          }
        ]);
        expect(activeParentsForChild(snapshot, 'item-11')).toEqual([
          'folder-a'
        ]);
      }

      if (pageNumber === 2) {
        expect(snapshot.acl).toEqual([]);
        expect(activeParentsForChild(snapshot, 'item-11')).toEqual([]);
      }

      if (pageNumber === 3) {
        expect(snapshot.acl).toEqual([]);
        expect(activeParentsForChild(snapshot, 'item-11')).toEqual([
          'folder-b'
        ]);
      }
    }

    const desktopReplica = new InMemoryReplicaHarness();
    const mobileReplica = new InMemoryReplicaHarness();
    await Promise.all([
      desktopReplica.syncWithPageSize(feedItems, 1, 4),
      mobileReplica.syncWithPageSize(feedItems, 3, 8)
    ]);

    const expectedCursor = {
      changedAt: '2026-02-14T04:20:06.000Z',
      changeId: 'desktop-22'
    };

    expect(serverSnapshot).toEqual({
      acl: [],
      links: [
        {
          parentId: 'folder-b',
          childId: 'item-11'
        }
      ],
      lastReconciledWriteIds: {
        desktop: 3,
        mobile: 2,
        tablet: 2
      }
    });
    expect(boundaryReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(desktopReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
    expect(mobileReplica.snapshot()).toEqual({
      acl: serverSnapshot.acl,
      links: serverSnapshot.links,
      cursor: expectedCursor
    });
  });
});
