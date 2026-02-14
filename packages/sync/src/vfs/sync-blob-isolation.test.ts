import { describe, expect, it } from 'vitest';
import { InMemoryVfsBlobIsolationStore } from './sync-blob-isolation.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('InMemoryVfsBlobIsolationStore', () => {
  it('requires reconcile state before attach', () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    const attached = store.attachWithIsolation({
      stagingId: 'stage-1',
      attachedBy: 'user-1',
      itemId: 'item-1',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:01.000Z',
        changeId: 'crdt-1'
      },
      requiredLastWriteIds: {
        desktop: 1
      }
    });

    expect(attached.status).toBe('reconcileRequired');
  });

  it('blocks attach when cursor or write ids are behind required visibility', () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-2',
      blobId: 'blob-2',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:01.000Z',
        changeId: 'crdt-1'
      },
      {
        desktop: 1
      }
    );

    const behindCursor = store.attachWithIsolation({
      stagingId: 'stage-2',
      attachedBy: 'user-1',
      itemId: 'item-2',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:02.000Z',
        changeId: 'crdt-2'
      },
      requiredLastWriteIds: {
        desktop: 1
      }
    });
    expect(behindCursor.status).toBe('reconcileBehind');

    const behindWriteIds = store.attachWithIsolation({
      stagingId: 'stage-2',
      attachedBy: 'user-1',
      itemId: 'item-2',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:01.000Z',
        changeId: 'crdt-1'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });
    expect(behindWriteIds.status).toBe('reconcileBehind');
  });

  it('attaches once reconcile state catches up', () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-3',
      blobId: 'blob-3',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-3'
      },
      {
        desktop: 3,
        mobile: 2
      }
    );

    const attached = store.attachWithIsolation({
      stagingId: 'stage-3',
      attachedBy: 'user-1',
      itemId: 'item-3',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:02.000Z',
        changeId: 'crdt-2'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });

    expect(attached).toEqual({
      stagingId: 'stage-3',
      status: 'applied',
      record: {
        stagingId: 'stage-3',
        blobId: 'blob-3',
        stagedBy: 'user-1',
        status: 'attached',
        stagedAt: '2026-02-14T07:00:00.000Z',
        expiresAt: '2026-02-14T07:10:00.000Z',
        attachedAt: '2026-02-14T07:01:00.000Z',
        attachedItemId: 'item-3'
      }
    });
  });

  it('handles concurrent reconcile and attach io deterministically', async () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-4',
      blobId: 'blob-4',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:01.000Z',
        changeId: 'crdt-1'
      },
      {
        desktop: 1
      }
    );

    const [earlyAttach, reconcile, lateAttach] = await Promise.all([
      (async () => {
        await wait(5);
        return store.attachWithIsolation({
          stagingId: 'stage-4',
          attachedBy: 'user-1',
          itemId: 'item-early',
          attachedAt: '2026-02-14T07:01:00.000Z',
          userId: 'user-1',
          clientId: 'desktop',
          requiredCursor: {
            changedAt: '2026-02-14T07:00:02.000Z',
            changeId: 'crdt-2'
          },
          requiredLastWriteIds: {
            desktop: 2
          }
        });
      })(),
      (async () => {
        await wait(10);
        return store.reconcileClient(
          'user-1',
          'desktop',
          {
            changedAt: '2026-02-14T07:00:02.000Z',
            changeId: 'crdt-2'
          },
          {
            desktop: 2
          }
        );
      })(),
      (async () => {
        await wait(15);
        return store.attachWithIsolation({
          stagingId: 'stage-4',
          attachedBy: 'user-1',
          itemId: 'item-late',
          attachedAt: '2026-02-14T07:01:01.000Z',
          userId: 'user-1',
          clientId: 'desktop',
          requiredCursor: {
            changedAt: '2026-02-14T07:00:02.000Z',
            changeId: 'crdt-2'
          },
          requiredLastWriteIds: {
            desktop: 2
          }
        });
      })()
    ]);

    expect(earlyAttach.status).toBe('reconcileBehind');
    expect(reconcile.advancedCursor).toBe(true);
    expect(reconcile.advancedLastReconciledWriteIds).toBe(true);
    expect(lateAttach.status).toBe('applied');
    expect(store.getBlobStage('stage-4')?.attachedItemId).toBe('item-late');
  });

  it('still enforces blob ownership rules after reconcile guardrails pass', () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-5',
      blobId: 'blob-5',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:02.000Z',
        changeId: 'crdt-2'
      },
      {
        desktop: 2
      }
    );

    const forbidden = store.attachWithIsolation({
      stagingId: 'stage-5',
      attachedBy: 'user-2',
      itemId: 'item-5',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:02.000Z',
        changeId: 'crdt-2'
      },
      requiredLastWriteIds: {
        desktop: 2
      }
    });

    expect(forbidden.status).toBe('forbidden');
  });

  it('keeps email attachment commits isolated until reconcile checkpoints catch up', () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-6',
      blobId: 'blob-6',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:02.000Z',
        changeId: 'crdt-email-2'
      },
      {
        desktop: 2,
        mobile: 1
      }
    );

    const firstRetry = store.attachWithIsolation({
      stagingId: 'stage-6',
      attachedBy: 'user-1',
      itemId: 'email-1',
      attachedAt: '2026-02-14T07:01:00.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-email-3'
      },
      requiredLastWriteIds: {
        desktop: 2,
        mobile: 2
      }
    });
    expect(firstRetry.status).toBe('reconcileBehind');
    expect(store.getBlobStage('stage-6')?.status).toBe('staged');

    const secondRetry = store.attachWithIsolation({
      stagingId: 'stage-6',
      attachedBy: 'user-1',
      itemId: 'email-1',
      attachedAt: '2026-02-14T07:01:01.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-email-3'
      },
      requiredLastWriteIds: {
        desktop: 2,
        mobile: 2
      }
    });
    expect(secondRetry.status).toBe('reconcileBehind');
    expect(store.getBlobStage('stage-6')?.status).toBe('staged');

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-email-3'
      },
      {
        desktop: 2,
        mobile: 2
      }
    );

    const attached = store.attachWithIsolation({
      stagingId: 'stage-6',
      attachedBy: 'user-1',
      itemId: 'email-1',
      attachedAt: '2026-02-14T07:01:02.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-email-3'
      },
      requiredLastWriteIds: {
        desktop: 2,
        mobile: 2
      }
    });
    expect(attached.status).toBe('applied');
    expect(attached.record?.attachedItemId).toBe('email-1');

    const postCommitRetry = store.attachWithIsolation({
      stagingId: 'stage-6',
      attachedBy: 'user-1',
      itemId: 'email-1',
      attachedAt: '2026-02-14T07:01:03.000Z',
      userId: 'user-1',
      clientId: 'desktop',
      requiredCursor: {
        changedAt: '2026-02-14T07:00:03.000Z',
        changeId: 'crdt-email-3'
      },
      requiredLastWriteIds: {
        desktop: 2,
        mobile: 2
      }
    });
    expect(postCommitRetry.status).toBe('conflict');
  });

  it('stays deterministic under interleaved email attachment retries across clients', async () => {
    const store = new InMemoryVfsBlobIsolationStore();

    store.stage({
      stagingId: 'stage-7',
      blobId: 'blob-7',
      stagedBy: 'user-1',
      stagedAt: '2026-02-14T07:00:00.000Z',
      expiresAt: '2026-02-14T07:10:00.000Z'
    });

    store.reconcileClient(
      'user-1',
      'desktop',
      {
        changedAt: '2026-02-14T07:00:04.000Z',
        changeId: 'crdt-email-4'
      },
      {
        desktop: 4,
        mobile: 2
      }
    );

    const [mobileEarly, desktopAttach, mobileLate] = await Promise.all([
      (async () => {
        await wait(5);
        return store.attachWithIsolation({
          stagingId: 'stage-7',
          attachedBy: 'user-1',
          itemId: 'email-2',
          attachedAt: '2026-02-14T07:02:00.000Z',
          userId: 'user-1',
          clientId: 'mobile',
          requiredCursor: {
            changedAt: '2026-02-14T07:00:04.000Z',
            changeId: 'crdt-email-4'
          },
          requiredLastWriteIds: {
            desktop: 4,
            mobile: 2
          }
        });
      })(),
      (async () => {
        await wait(10);
        return store.attachWithIsolation({
          stagingId: 'stage-7',
          attachedBy: 'user-1',
          itemId: 'email-2',
          attachedAt: '2026-02-14T07:02:01.000Z',
          userId: 'user-1',
          clientId: 'desktop',
          requiredCursor: {
            changedAt: '2026-02-14T07:00:04.000Z',
            changeId: 'crdt-email-4'
          },
          requiredLastWriteIds: {
            desktop: 4,
            mobile: 2
          }
        });
      })(),
      (async () => {
        await wait(12);
        store.reconcileClient(
          'user-1',
          'mobile',
          {
            changedAt: '2026-02-14T07:00:04.000Z',
            changeId: 'crdt-email-4'
          },
          {
            desktop: 4,
            mobile: 2
          }
        );
        return store.attachWithIsolation({
          stagingId: 'stage-7',
          attachedBy: 'user-1',
          itemId: 'email-2',
          attachedAt: '2026-02-14T07:02:02.000Z',
          userId: 'user-1',
          clientId: 'mobile',
          requiredCursor: {
            changedAt: '2026-02-14T07:00:04.000Z',
            changeId: 'crdt-email-4'
          },
          requiredLastWriteIds: {
            desktop: 4,
            mobile: 2
          }
        });
      })()
    ]);

    expect(mobileEarly.status).toBe('reconcileRequired');
    expect(desktopAttach.status).toBe('applied');
    expect(mobileLate.status).toBe('conflict');
    expect(store.getBlobStage('stage-7')?.attachedItemId).toBe('email-2');
  });
});
