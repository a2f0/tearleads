import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncItem } from './sync-crdt-feed.js';
import {
  InMemoryVfsCrdtFeedReplayStore,
  type VfsCrdtFeedReplaySnapshot
} from './sync-crdt-feed-replay.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class ReplicaHarness {
  constructor(private readonly store: InMemoryVfsCrdtFeedReplayStore) {}

  async applyWithDelay(
    pages: Array<{ delayMs: number; items: VfsCrdtSyncItem[] }>
  ): Promise<VfsCrdtFeedReplaySnapshot> {
    for (const page of pages) {
      await wait(page.delayMs);
      this.store.applyPage(page.items);
    }

    return this.store.snapshot();
  }
}

describe('InMemoryVfsCrdtFeedReplayStore', () => {
  it('replays paginated CRDT feed and advances local cursor', () => {
    const store = new InMemoryVfsCrdtFeedReplayStore();

    const firstPage: VfsCrdtSyncItem[] = [
      {
        opId: 'op-1',
        itemId: 'item-1',
        opType: 'acl_add',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-1',
        occurredAt: '2026-02-14T00:00:00.000Z'
      },
      {
        opId: 'op-2',
        itemId: 'item-1',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'root',
        childId: 'item-1',
        actorId: 'user-1',
        sourceTable: 'vfs_links',
        sourceId: 'link-1',
        occurredAt: '2026-02-14T00:00:01.000Z'
      }
    ];

    const secondPage: VfsCrdtSyncItem[] = [
      {
        opId: 'op-3',
        itemId: 'item-1',
        opType: 'acl_add',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write',
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-1',
        occurredAt: '2026-02-14T00:00:02.000Z'
      },
      {
        opId: 'op-4',
        itemId: 'item-1',
        opType: 'link_remove',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'root',
        childId: 'item-1',
        actorId: 'user-1',
        sourceTable: 'vfs_links',
        sourceId: 'link-1',
        occurredAt: '2026-02-14T00:00:03.000Z'
      }
    ];

    store.applyPage(firstPage);
    const cursor = store.applyPage(secondPage);

    expect(cursor).toEqual({
      changedAt: '2026-02-14T00:00:03.000Z',
      changeId: 'op-4'
    });

    expect(store.snapshot()).toEqual({
      acl: [
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'write'
        }
      ],
      links: [],
      cursor: {
        changedAt: '2026-02-14T00:00:03.000Z',
        changeId: 'op-4'
      }
    });
  });

  it('rejects stale or non-monotonic page cursors', () => {
    const store = new InMemoryVfsCrdtFeedReplayStore();

    store.applyPage([
      {
        opId: 'op-2',
        itemId: 'item-1',
        opType: 'acl_add',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read',
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-1',
        occurredAt: '2026-02-14T00:00:01.000Z'
      }
    ]);

    expect(() =>
      store.applyPage([
        {
          opId: 'op-1',
          itemId: 'item-1',
          opType: 'acl_add',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'write',
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'share-1',
          occurredAt: '2026-02-14T00:00:00.000Z'
        }
      ])
    ).toThrowError(/not strictly newer than local cursor/);
  });

  it('rejects invalid acl and link operations', () => {
    const store = new InMemoryVfsCrdtFeedReplayStore();

    expect(() =>
      store.applyPage([
        {
          opId: 'op-1',
          itemId: 'item-1',
          opType: 'acl_add',
          principalType: null,
          principalId: 'user-2',
          accessLevel: 'write',
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'share-1',
          occurredAt: '2026-02-14T00:00:00.000Z'
        }
      ])
    ).toThrowError(/missing principal fields/);

    expect(() =>
      store.applyPage([
        {
          opId: 'op-2',
          itemId: 'item-1',
          opType: 'link_add',
          principalType: null,
          principalId: null,
          accessLevel: null,
          parentId: null,
          childId: 'item-1',
          actorId: 'user-1',
          sourceTable: 'vfs_links',
          sourceId: 'link-1',
          occurredAt: '2026-02-14T00:00:01.000Z'
        }
      ])
    ).toThrowError(/missing link fields/);
  });

  it('converges multiple clients to same snapshot under asynchronous page delivery', async () => {
    const pageA: VfsCrdtSyncItem[] = [
      {
        opId: 'op-1',
        itemId: 'item-9',
        opType: 'acl_add',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read',
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-9',
        occurredAt: '2026-02-14T00:00:00.000Z'
      }
    ];

    const pageB: VfsCrdtSyncItem[] = [
      {
        opId: 'op-2',
        itemId: 'item-9',
        opType: 'acl_add',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write',
        parentId: null,
        childId: null,
        actorId: 'user-1',
        sourceTable: 'vfs_crdt_client_push',
        sourceId: 'share-9',
        occurredAt: '2026-02-14T00:00:01.000Z'
      },
      {
        opId: 'op-3',
        itemId: 'item-9',
        opType: 'link_add',
        principalType: null,
        principalId: null,
        accessLevel: null,
        parentId: 'root',
        childId: 'item-9',
        actorId: 'user-1',
        sourceTable: 'vfs_links',
        sourceId: 'link-9',
        occurredAt: '2026-02-14T00:00:02.000Z'
      }
    ];

    const desktop = new ReplicaHarness(new InMemoryVfsCrdtFeedReplayStore());
    const mobile = new ReplicaHarness(new InMemoryVfsCrdtFeedReplayStore());

    const [desktopSnapshot, mobileSnapshot] = await Promise.all([
      desktop.applyWithDelay([
        { delayMs: 5, items: pageA },
        { delayMs: 15, items: pageB }
      ]),
      mobile.applyWithDelay([
        { delayMs: 10, items: pageA },
        { delayMs: 20, items: pageB }
      ])
    ]);

    expect(desktopSnapshot).toEqual(mobileSnapshot);
    expect(desktopSnapshot).toEqual({
      acl: [
        {
          itemId: 'item-9',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write'
        }
      ],
      links: [
        {
          parentId: 'root',
          childId: 'item-9'
        }
      ],
      cursor: {
        changedAt: '2026-02-14T00:00:02.000Z',
        changeId: 'op-3'
      }
    });
  });
});
