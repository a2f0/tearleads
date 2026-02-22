import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('reconciles stale write ids by rebasing local pending writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T12:10:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:10:01.000Z'
    });

    const flushResult = await client.flush();
    expect(flushResult.pushedOperations).toBe(1);
    expect(flushResult.pullPages).toBe(1);

    const clientSnapshot = client.snapshot();
    const serverSnapshot = server.snapshot();
    expect(clientSnapshot.pendingOperations).toBe(0);
    expect(clientSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(clientSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(clientSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2
    });
    expect(clientSnapshot.nextLocalWriteId).toBe(3);
  });

  it('rebases pending occurredAt ahead of cursor before push', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-mobile-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T12:30:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      new InMemoryVfsCrdtSyncTransport(server)
    );

    await desktop.sync();
    const cursorBeforeQueue = desktop.snapshot().cursor;
    expect(cursorBeforeQueue?.changedAt).toBe('2026-02-14T12:30:00.000Z');

    const queued = desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:20:00.000Z'
    });
    await desktop.flush();
    await observer.sync();

    const pushedFeedItem = server
      .snapshot()
      .feed.find((item) => item.opId === queued.opId);
    expect(pushedFeedItem).toBeDefined();
    if (!pushedFeedItem) {
      throw new Error(`missing pushed feed item ${queued.opId}`);
    }

    /**
     * Guardrail assertion: normalized timestamps must stay strictly ahead of the
     * previously reconciled cursor to prevent canonical-feed backfill gaps.
     */
    const pushedOccurredAtMs = Date.parse(pushedFeedItem.occurredAt);
    const cursorMs = Date.parse(cursorBeforeQueue?.changedAt ?? '');
    expect(Number.isFinite(pushedOccurredAtMs)).toBe(true);
    expect(Number.isFinite(cursorMs)).toBe(true);
    expect(pushedOccurredAtMs).toBeGreaterThan(cursorMs);
    expect(observer.snapshot().acl).toEqual(server.snapshot().acl);
  });

  it('fails closed when stale write ids cannot be recovered', async () => {
    let pushAttempts = 0;
    let pullAttempts = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushAttempts += 1;
        return {
          results: input.operations.map((operation) => ({
            opId: operation.opId,
            status: 'staleWriteId'
          }))
        };
      },
      pullOperations: async () => {
        pullAttempts += 1;
        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        };
      }
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:10:01.000Z'
    });

    await expect(client.flush()).rejects.toBeInstanceOf(
      VfsCrdtSyncPushRejectedError
    );
    expect(client.snapshot().pendingOperations).toBe(1);
    expect(pushAttempts).toBe(3);
    expect(pullAttempts).toBe(2);
    expect(guardrailViolations).toContainEqual({
      code: 'staleWriteRecoveryExhausted',
      stage: 'flush',
      message:
        'stale write-id recovery exceeded max retry attempts without forward progress'
    });
  });

  it('fails closed when push rejects encrypted envelopes as unsupported', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => ({
        results: input.operations.map((operation) => ({
          opId: operation.opId,
          status: 'encryptedEnvelopeUnsupported'
        }))
      }),
      pullOperations: async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
        lastReconciledWriteIds: {}
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:10:01.000Z'
    });

    await expect(client.flush()).rejects.toBeInstanceOf(
      VfsCrdtSyncPushRejectedError
    );
    expect(client.snapshot().pendingOperations).toBe(1);
  });

  it('converges concurrent clients when one client requires stale-write recovery', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T12:15:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 10,
        pullDelayMs: 2
      })
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 1,
        pullDelayMs: 8
      })
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:15:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T12:15:02.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush()]);
    await Promise.all([desktop.sync(), mobile.sync()]);

    const serverSnapshot = server.snapshot();
    const desktopSnapshot = desktop.snapshot();
    const mobileSnapshot = mobile.snapshot();
    expect(desktopSnapshot.pendingOperations).toBe(0);
    expect(mobileSnapshot.pendingOperations).toBe(0);
    expect(desktopSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(mobileSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(desktopSnapshot.links).toEqual(serverSnapshot.links);
    expect(mobileSnapshot.links).toEqual(serverSnapshot.links);
    expect(desktopSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(mobileSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 1
    });
  });
});
