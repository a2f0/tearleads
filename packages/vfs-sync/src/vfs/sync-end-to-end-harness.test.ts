import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsBlobIsolationStore,
  InMemoryVfsCrdtFeedReplayStore,
  InMemoryVfsCrdtStateStore,
  type VfsCrdtOperation,
  type VfsCrdtSyncItem
} from './index.js';

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
    actorId: 'user-1',
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

describe('VFS sync end-to-end harness', () => {
  it('gates blob attach until reconcile reaches required CRDT visibility', () => {
    const serverStore = new InMemoryVfsCrdtStateStore();
    const clientReplayStore = new InMemoryVfsCrdtFeedReplayStore();
    const blobIsolationStore = new InMemoryVfsBlobIsolationStore();

    const operations: VfsCrdtOperation[] = [
      {
        opId: 'desktop-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T08:00:01.000Z',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'read'
      },
      {
        opId: 'desktop-2',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T08:00:02.000Z',
        parentId: 'root',
        childId: 'item-1'
      },
      {
        opId: 'mobile-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T08:00:03.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }
    ];

    const serverResults = serverStore.applyMany(operations);
    expect(serverResults.map((result) => result.status)).toEqual([
      'applied',
      'applied',
      'applied'
    ]);

    const feed = operations.map(toSyncItem).sort(compareFeedItems);
    blobIsolationStore.stage({
      stagingId: 'stage-e2e-1',
      blobId: 'blob-e2e-1',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T08:05:00.000Z',
      expiresAt: '2026-02-14T08:35:00.000Z'
    });

    clientReplayStore.applyPage(feed.slice(0, 1));
    const firstCursor = clientReplayStore.snapshot().cursor;
    if (!firstCursor) {
      throw new Error('expected first cursor');
    }

    blobIsolationStore.reconcileClient('user-1', 'desktop', firstCursor, {
      desktop: 1
    });

    const blockedAttach = blobIsolationStore.attachWithIsolation({
      stagingId: 'stage-e2e-1',
      attachedBy: 'user-1',
      itemId: 'item-1',
      attachedAt: '2026-02-14T08:06:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T08:00:02.000Z',
        changeId: 'desktop-2'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });
    expect(blockedAttach.status).toBe('reconcileBehind');

    clientReplayStore.applyPage(feed.slice(1));
    const finalCursor = clientReplayStore.snapshot().cursor;
    if (!finalCursor) {
      throw new Error('expected final cursor');
    }

    const serverSnapshot = serverStore.snapshot();
    blobIsolationStore.reconcileClient(
      'user-1',
      'desktop',
      finalCursor,
      serverSnapshot.lastReconciledWriteIds
    );

    const attached = blobIsolationStore.attachWithIsolation({
      stagingId: 'stage-e2e-1',
      attachedBy: 'user-1',
      itemId: 'item-1',
      attachedAt: '2026-02-14T08:06:01.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T08:00:02.000Z',
        changeId: 'desktop-2'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });
    expect(attached.status).toBe('applied');
  });

  it('remains deterministic with concurrent reconcile/attach attempts', async () => {
    const blobIsolationStore = new InMemoryVfsBlobIsolationStore();

    blobIsolationStore.stage({
      stagingId: 'stage-e2e-2',
      blobId: 'blob-e2e-2',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T09:00:00.000Z',
      expiresAt: '2026-02-14T09:30:00.000Z'
    });

    blobIsolationStore.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T09:00:01.000Z',
        changeId: 'desktop-1'
      },
      {
        desktop: 1
      }
    );

    const [earlyAttach, mobileReconcile, desktopReconcile, lateAttach] =
      await Promise.all([
        (async () => {
          await wait(5);
          return blobIsolationStore.attachWithIsolation({
            stagingId: 'stage-e2e-2',
            attachedBy: 'user-1',
            itemId: 'item-2-early',
            attachedAt: '2026-02-14T09:05:00.000Z',
            userId: 'user-1',
            clientId: 'desktop',
            requiredCursor: {
              changedAt: '2026-02-14T09:00:02.000Z',
              changeId: 'desktop-2'
            },
            requiredLastWriteIds: {
              desktop: 2
            }
          });
        })(),
        (async () => {
          await wait(8);
          return blobIsolationStore.reconcileClient(
            'user-1',
            'mobile',
            {
              changedAt: '2026-02-14T09:00:03.000Z',
              changeId: 'mobile-1'
            },
            {
              mobile: 1
            }
          );
        })(),
        (async () => {
          await wait(10);
          return blobIsolationStore.reconcileClient(
            'user-1',
            'desktop',
            {
              changedAt: '2026-02-14T09:00:02.000Z',
              changeId: 'desktop-2'
            },
            {
              desktop: 2
            }
          );
        })(),
        (async () => {
          await wait(15);
          return blobIsolationStore.attachWithIsolation({
            stagingId: 'stage-e2e-2',
            attachedBy: 'user-1',
            itemId: 'item-2-late',
            attachedAt: '2026-02-14T09:05:01.000Z',
            userId: 'user-1',
            clientId: 'desktop',
            requiredCursor: {
              changedAt: '2026-02-14T09:00:02.000Z',
              changeId: 'desktop-2'
            },
            requiredLastWriteIds: {
              desktop: 2
            }
          });
        })()
      ]);

    expect(earlyAttach.status).toBe('reconcileBehind');
    expect(mobileReconcile.advancedCursor).toBe(true);
    expect(desktopReconcile.advancedCursor).toBe(true);
    expect(lateAttach.status).toBe('applied');
    expect(blobIsolationStore.getBlobStage('stage-e2e-2')?.attachedItemId).toBe(
      'item-2-late'
    );
  });

  it('attaches blobs to email items through the same generic isolation path', () => {
    const serverStore = new InMemoryVfsCrdtStateStore();
    const clientReplayStore = new InMemoryVfsCrdtFeedReplayStore();
    const blobIsolationStore = new InMemoryVfsBlobIsolationStore();

    const operations: VfsCrdtOperation[] = [
      {
        opId: 'desktop-email-1',
        opType: 'acl_add',
        itemId: 'email-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T12:00:01.000Z',
        principalType: 'user',
        principalId: 'user-2',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-email-2',
        opType: 'link_add',
        itemId: 'email-1',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T12:00:02.000Z',
        parentId: 'mailbox-inbox',
        childId: 'email-1'
      }
    ];

    const serverResults = serverStore.applyMany(operations);
    expect(serverResults.map((result) => result.status)).toEqual([
      'applied',
      'applied'
    ]);

    const feed = operations.map(toSyncItem).sort(compareFeedItems);
    clientReplayStore.applyPage(feed);
    const cursor = clientReplayStore.snapshot().cursor;
    if (!cursor) {
      throw new Error('expected cursor after replaying email feed');
    }

    const serverSnapshot = serverStore.snapshot();
    blobIsolationStore.reconcileClient(
      'user-1',
      'desktop',
      cursor,
      serverSnapshot.lastReconciledWriteIds
    );

    blobIsolationStore.stage({
      stagingId: 'stage-email-1',
      blobId: 'blob-email-attachment-1',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T12:05:00.000Z',
      expiresAt: '2026-02-14T12:35:00.000Z'
    });

    const result = blobIsolationStore.attachWithIsolation({
      stagingId: 'stage-email-1',
      attachedBy: 'user-1',
      itemId: 'email-1',
      attachedAt: '2026-02-14T12:05:01.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T12:00:02.000Z',
        changeId: 'desktop-email-2'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });

    expect(result.status).toBe('applied');
    expect(
      blobIsolationStore.getBlobStage('stage-email-1')?.attachedItemId
    ).toBe('email-1');
  });
});
