import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsContainerClockStore,
  type VfsContainerClockEntry
} from './sync-container-clocks.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function aclItem(params: {
  opId: string;
  itemId: string;
  occurredAt: string;
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId,
    opType: 'acl_add',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    parentId: null,
    childId: null,
    actorId: null,
    sourceTable: 'test',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}

function linkItem(params: {
  opId: string;
  parentId: string;
  childId: string;
  occurredAt: string;
  opType?: 'link_add' | 'link_remove';
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.childId,
    opType: params.opType ?? 'link_add',
    principalType: null,
    principalId: null,
    accessLevel: null,
    parentId: params.parentId,
    childId: params.childId,
    actorId: null,
    sourceTable: 'test',
    sourceId: params.opId,
    occurredAt: params.occurredAt
  };
}

describe('InMemoryVfsContainerClockStore', () => {
  it('tracks the latest change per container and ignores stale updates', () => {
    const store = new InMemoryVfsContainerClockStore();

    store.applyFeedItems([
      linkItem({
        opId: 'op-1',
        parentId: 'root',
        childId: 'item-1',
        occurredAt: '2026-02-14T13:00:00.000Z'
      }),
      aclItem({
        opId: 'op-2',
        itemId: 'item-2',
        occurredAt: '2026-02-14T13:00:01.000Z'
      }),
      linkItem({
        opId: 'op-0',
        parentId: 'root',
        childId: 'item-1',
        occurredAt: '2026-02-14T12:59:59.000Z',
        opType: 'link_remove'
      }),
      linkItem({
        opId: 'op-3',
        parentId: 'root',
        childId: 'item-1',
        occurredAt: '2026-02-14T13:00:02.000Z'
      })
    ]);

    expect(store.snapshot()).toEqual([
      {
        containerId: 'item-2',
        changedAt: '2026-02-14T13:00:01.000Z',
        changeId: 'op-2'
      },
      {
        containerId: 'root',
        changedAt: '2026-02-14T13:00:02.000Z',
        changeId: 'op-3'
      }
    ]);
  });

  it('paginates container changes by cursor', () => {
    const store = new InMemoryVfsContainerClockStore();

    store.applyFeedItems([
      aclItem({
        opId: 'op-1',
        itemId: 'item-1',
        occurredAt: '2026-02-14T13:10:00.000Z'
      }),
      aclItem({
        opId: 'op-2',
        itemId: 'item-2',
        occurredAt: '2026-02-14T13:10:01.000Z'
      }),
      linkItem({
        opId: 'op-3',
        parentId: 'root',
        childId: 'item-3',
        occurredAt: '2026-02-14T13:10:02.000Z'
      })
    ]);

    const firstPage = store.listChangedSince(null, 2);
    expect(firstPage.items).toEqual([
      {
        containerId: 'item-1',
        changedAt: '2026-02-14T13:10:00.000Z',
        changeId: 'op-1'
      },
      {
        containerId: 'item-2',
        changedAt: '2026-02-14T13:10:01.000Z',
        changeId: 'op-2'
      }
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual({
      changedAt: '2026-02-14T13:10:01.000Z',
      changeId: 'op-2'
    });

    const secondPage = store.listChangedSince(firstPage.nextCursor, 2);
    expect(secondPage.items).toEqual([
      {
        containerId: 'root',
        changedAt: '2026-02-14T13:10:02.000Z',
        changeId: 'op-3'
      }
    ]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toEqual({
      changedAt: '2026-02-14T13:10:02.000Z',
      changeId: 'op-3'
    });
  });

  it('throws for invalid feed items', () => {
    const store = new InMemoryVfsContainerClockStore();

    expect(() =>
      store.applyFeedItems([
        aclItem({
          opId: ' ',
          itemId: 'item-1',
          occurredAt: '2026-02-14T13:20:00.000Z'
        })
      ])
    ).toThrowError(/invalid cursor fields/);

    expect(() =>
      store.applyFeedItems([
        linkItem({
          opId: 'op-1',
          parentId: ' ',
          childId: 'item-1',
          occurredAt: '2026-02-14T13:20:00.000Z'
        })
      ])
    ).toThrowError(/invalid container fields/);
  });

  it('remains deterministic under concurrent io', async () => {
    const store = new InMemoryVfsContainerClockStore();

    await Promise.all([
      (async () => {
        await wait(20);
        store.applyFeedItems([
          aclItem({
            opId: 'desktop-1',
            itemId: 'item-1',
            occurredAt: '2026-02-14T13:30:00.000Z'
          })
        ]);
      })(),
      (async () => {
        await wait(5);
        store.applyFeedItems([
          aclItem({
            opId: 'mobile-1',
            itemId: 'item-1',
            occurredAt: '2026-02-14T13:30:01.000Z'
          }),
          linkItem({
            opId: 'mobile-2',
            parentId: 'root',
            childId: 'item-2',
            occurredAt: '2026-02-14T13:30:02.000Z'
          })
        ]);
      })()
    ]);

    expect(store.snapshot()).toEqual<VfsContainerClockEntry[]>([
      {
        containerId: 'item-1',
        changedAt: '2026-02-14T13:30:01.000Z',
        changeId: 'mobile-1'
      },
      {
        containerId: 'root',
        changedAt: '2026-02-14T13:30:02.000Z',
        changeId: 'mobile-2'
      }
    ]);
  });
});
