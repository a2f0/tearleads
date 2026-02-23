import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsAccessHarness,
  InMemoryVfsCrdtStateStore,
  type VfsCrdtOperation,
  type VfsCrdtSyncItem
} from '../index.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toSyncItem(operation: VfsCrdtOperation): VfsCrdtSyncItem {
  return {
    opId: operation.opId,
    itemId: operation.itemId,
    opType: operation.opType,
    principalType: operation.principalType ?? null,
    principalId: operation.principalId ?? null,
    accessLevel: operation.accessLevel ?? null,
    parentId: operation.parentId ?? null,
    childId: operation.childId ?? null,
    actorId: 'test-actor',
    sourceTable: 'test',
    sourceId: operation.opId,
    occurredAt: operation.occurredAt
  };
}

function compareFeedItems(
  left: VfsCrdtSyncItem,
  right: VfsCrdtSyncItem
): number {
  const leftMs = Date.parse(left.occurredAt);
  const rightMs = Date.parse(right.occurredAt);

  if (leftMs < rightMs) {
    return -1;
  }

  if (leftMs > rightMs) {
    return 1;
  }

  return left.opId.localeCompare(right.opId);
}

class InMemoryCrdtAccessServerHarness {
  private readonly store = new InMemoryVfsCrdtStateStore();
  private readonly feedLog: VfsCrdtSyncItem[] = [];

  async applyConcurrent(
    writes: Array<{ delayMs: number; operation: VfsCrdtOperation }>
  ): Promise<void> {
    await Promise.all(
      writes.map(async ({ delayMs, operation }) => {
        await wait(delayMs);
        const result = this.store.apply(operation);
        if (result.status === 'applied') {
          this.feedLog.push(toSyncItem(operation));
        }
      })
    );

    this.feedLog.sort(compareFeedItems);
  }

  feed(): VfsCrdtSyncItem[] {
    return this.feedLog.slice();
  }
}

async function syncInPages(
  harness: InMemoryVfsAccessHarness,
  feed: VfsCrdtSyncItem[],
  pageSize: number,
  delayMs: number
): Promise<void> {
  for (let index = 0; index < feed.length; index += pageSize) {
    await wait(delayMs);
    harness.applyCrdtPage(feed.slice(index, index + pageSize));
  }
}

describe('sync access protocol harness', () => {
  it('converges precedence under concurrent grants and revokes across replicas', async () => {
    const server = new InMemoryCrdtAccessServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 25,
        operation: {
          opId: 'desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T09:00:01.000Z',
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
          occurredAt: '2026-02-14T09:00:02.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'write'
        }
      },
      {
        delayMs: 20,
        operation: {
          opId: 'tablet-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T09:00:03.000Z',
          principalType: 'user',
          principalId: 'user-9',
          accessLevel: 'admin'
        }
      },
      {
        delayMs: 15,
        operation: {
          opId: 'desktop-2',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T09:00:04.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'admin'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'mobile-2',
          opType: 'acl_remove',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T09:00:05.000Z',
          principalType: 'user',
          principalId: 'user-9'
        }
      },
      {
        delayMs: 12,
        operation: {
          opId: 'tablet-2',
          opType: 'acl_remove',
          itemId: 'item-1',
          replicaId: 'tablet',
          writeId: 2,
          occurredAt: '2026-02-14T09:00:06.000Z',
          principalType: 'group',
          principalId: 'group-1'
        }
      },
      {
        delayMs: 8,
        operation: {
          opId: 'desktop-3',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 3,
          occurredAt: '2026-02-14T09:00:07.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'read'
        }
      },
      {
        delayMs: 30,
        operation: {
          opId: 'mobile-3',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 3,
          occurredAt: '2026-02-14T09:00:08.000Z',
          principalType: 'user',
          principalId: 'user-9',
          accessLevel: 'write'
        }
      }
    ]);

    const feed = server.feed();
    const clients = [
      new InMemoryVfsAccessHarness(),
      new InMemoryVfsAccessHarness(),
      new InMemoryVfsAccessHarness()
    ];

    for (const client of clients) {
      client.setAclSnapshotEntries([
        {
          itemId: 'item-1',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'admin',
          wrappedSessionKey: 'session-group-1',
          wrappedHierarchicalKey: null,
          updatedAt: '2026-02-14T08:59:00.000Z',
          revokedAt: null,
          expiresAt: null
        },
        {
          itemId: 'item-1',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'read',
          wrappedSessionKey: 'session-org-1',
          wrappedHierarchicalKey: null,
          updatedAt: '2026-02-14T08:59:01.000Z',
          revokedAt: null,
          expiresAt: null
        },
        {
          itemId: 'item-1',
          principalType: 'user',
          principalId: 'user-9',
          accessLevel: 'write',
          wrappedSessionKey: 'session-user-9',
          wrappedHierarchicalKey: null,
          updatedAt: '2026-02-14T08:59:02.000Z',
          revokedAt: null,
          expiresAt: null
        }
      ]);
      client.replaceMembershipSnapshot({
        cursor: {
          changedAt: '2026-02-14T09:10:00.000Z',
          changeId: 'membership-1'
        },
        members: [
          {
            userId: 'user-9',
            groupIds: ['group-1'],
            organizationIds: ['org-1']
          }
        ]
      });
    }

    await Promise.all([
      syncInPages(clients[0], feed, 1, 4),
      syncInPages(clients[1], feed, 2, 8),
      syncInPages(clients[2], feed, 3, 12)
    ]);

    const expected = [
      {
        itemId: 'item-1',
        accessLevel: 'write',
        principalType: 'user',
        principalId: 'user-9',
        wrappedSessionKey: 'session-user-9',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T08:59:02.000Z'
      }
    ];

    for (const client of clients) {
      expect(client.buildEffectiveAccessForUser('user-9')).toEqual(expected);
    }
  });

  it('tracks precedence transitions as higher grants are revoked in later pages', async () => {
    const server = new InMemoryCrdtAccessServerHarness();

    await server.applyConcurrent([
      {
        delayMs: 5,
        operation: {
          opId: 'desktop-10',
          opType: 'acl_add',
          itemId: 'item-2',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T10:00:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'read'
        }
      },
      {
        delayMs: 10,
        operation: {
          opId: 'mobile-10',
          opType: 'acl_add',
          itemId: 'item-2',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T10:00:02.000Z',
          principalType: 'user',
          principalId: 'user-22',
          accessLevel: 'write'
        }
      },
      {
        delayMs: 15,
        operation: {
          opId: 'tablet-10',
          opType: 'acl_add',
          itemId: 'item-2',
          replicaId: 'tablet',
          writeId: 1,
          occurredAt: '2026-02-14T10:00:03.000Z',
          principalType: 'organization',
          principalId: 'org-2',
          accessLevel: 'admin'
        }
      },
      {
        delayMs: 20,
        operation: {
          opId: 'desktop-11',
          opType: 'acl_remove',
          itemId: 'item-2',
          replicaId: 'desktop',
          writeId: 2,
          occurredAt: '2026-02-14T10:00:04.000Z',
          principalType: 'organization',
          principalId: 'org-2'
        }
      },
      {
        delayMs: 25,
        operation: {
          opId: 'mobile-11',
          opType: 'acl_remove',
          itemId: 'item-2',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-14T10:00:05.000Z',
          principalType: 'user',
          principalId: 'user-22'
        }
      }
    ]);

    const harness = new InMemoryVfsAccessHarness();
    harness.setAclSnapshotEntries([
      {
        itemId: 'item-2',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'read',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T09:59:00.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-2',
        principalType: 'user',
        principalId: 'user-22',
        accessLevel: 'write',
        wrappedSessionKey: 'session-user-22',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T09:59:01.000Z',
        revokedAt: null,
        expiresAt: null
      },
      {
        itemId: 'item-2',
        principalType: 'organization',
        principalId: 'org-2',
        accessLevel: 'admin',
        wrappedSessionKey: 'session-org-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T09:59:02.000Z',
        revokedAt: null,
        expiresAt: null
      }
    ]);
    harness.replaceMembershipSnapshot({
      cursor: {
        changedAt: '2026-02-14T10:10:00.000Z',
        changeId: 'membership-2'
      },
      members: [
        {
          userId: 'user-22',
          groupIds: ['group-2'],
          organizationIds: ['org-2']
        }
      ]
    });

    const feed = server.feed();
    harness.applyCrdtPage(feed.slice(0, 3));
    expect(harness.buildEffectiveAccessForUser('user-22')).toEqual([
      {
        itemId: 'item-2',
        accessLevel: 'admin',
        principalType: 'organization',
        principalId: 'org-2',
        wrappedSessionKey: 'session-org-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T09:59:02.000Z'
      }
    ]);

    harness.applyCrdtPage(feed.slice(3));
    expect(harness.buildEffectiveAccessForUser('user-22')).toEqual([
      {
        itemId: 'item-2',
        accessLevel: 'read',
        principalType: 'group',
        principalId: 'group-2',
        wrappedSessionKey: 'session-group-2',
        wrappedHierarchicalKey: null,
        updatedAt: '2026-02-14T09:59:00.000Z'
      }
    ]);
  });
});
