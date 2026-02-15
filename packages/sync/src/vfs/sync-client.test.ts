import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import {
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError,
  type VfsCrdtSyncTransport
} from './sync-client.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';
import { compareVfsSyncCursorOrder } from './sync-reconcile.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await wait(5);
  }

  throw new Error('Timed out waiting for condition');
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function nextInt(
  random: () => number,
  minInclusive: number,
  maxInclusive: number
): number {
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(random() * span);
}

function pickOne<T>(values: readonly T[], random: () => number): T {
  const index = nextInt(random, 0, values.length - 1);
  const value = values[index];
  if (value === undefined) {
    throw new Error('cannot pick from an empty list');
  }

  return value;
}

function pickDifferent<T>(
  values: readonly T[],
  excluded: T,
  random: () => number
): T {
  if (values.length < 2) {
    throw new Error('need at least two values to pick a different entry');
  }

  let candidate = pickOne(values, random);
  while (candidate === excluded) {
    candidate = pickOne(values, random);
  }

  return candidate;
}

function createDeterministicJitterTransport(input: {
  server: InMemoryVfsCrdtSyncServer;
  random: () => number;
  maxDelayMs: number;
  canonicalClock: {
    currentMs: number;
  };
}): VfsCrdtSyncTransport {
  const nextDelayMs = (): number =>
    nextInt(input.random, 0, Math.max(0, input.maxDelayMs));

  return {
    pushOperations: async (pushInput) => {
      /**
       * Guardrail harness behavior: cursor pagination requires feed order to be
       * append-only relative to observed cursors. Normalize pushed timestamps so
       * canonical feed ordering tracks server apply order under random delays.
       */
      const normalizedOperations = pushInput.operations.map((operation) => {
        const parsedOccurredAtMs = Date.parse(operation.occurredAt);
        const baseOccurredAtMs = Number.isFinite(parsedOccurredAtMs)
          ? parsedOccurredAtMs
          : input.canonicalClock.currentMs;
        input.canonicalClock.currentMs = Math.max(
          input.canonicalClock.currentMs + 1,
          baseOccurredAtMs
        );
        return {
          ...operation,
          occurredAt: new Date(input.canonicalClock.currentMs).toISOString()
        };
      });

      await wait(nextDelayMs());
      return input.server.pushOperations({
        operations: normalizedOperations
      });
    },
    pullOperations: async (pullInput) => {
      await wait(nextDelayMs());
      return input.server.pullOperations({
        cursor: pullInput.cursor,
        limit: pullInput.limit
      });
    },
    reconcileState: async (reconcileInput) => {
      /**
       * Guardrail harness behavior: reconcile acknowledgements are modeled as an
       * authoritative replica-clock merge from server state while preserving the
       * client's cursor. This exercises the client reconcile lifecycle in tests
       * without requiring a separate server-side cursor table in-memory.
       */
      await wait(nextDelayMs());
      const snapshot = input.server.snapshot();
      return {
        cursor: reconcileInput.cursor,
        lastReconciledWriteIds: snapshot.lastReconciledWriteIds
      };
    }
  };
}

function buildAclAddSyncItem(params: {
  opId: string;
  occurredAt: string;
  itemId?: string;
}): VfsCrdtSyncItem {
  return {
    opId: params.opId,
    itemId: params.itemId ?? 'item-1',
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

interface ContainerClockCursor {
  containerId: string;
  changedAt: string;
  changeId: string;
}

function toContainerClockCursorMap(
  clocks: ContainerClockCursor[]
): Map<string, { changedAt: string; changeId: string }> {
  const result = new Map<string, { changedAt: string; changeId: string }>();
  for (const clock of clocks) {
    result.set(clock.containerId, {
      changedAt: clock.changedAt,
      changeId: clock.changeId
    });
  }
  return result;
}

function expectContainerClocksMonotonic(
  before: ContainerClockCursor[],
  after: ContainerClockCursor[]
): void {
  const beforeMap = toContainerClockCursorMap(before);
  const afterMap = toContainerClockCursorMap(after);

  for (const [containerId, beforeCursor] of beforeMap.entries()) {
    const afterCursor = afterMap.get(containerId);
    expect(afterCursor).toBeDefined();
    if (!afterCursor) {
      continue;
    }

    expect(
      compareVfsSyncCursorOrder(afterCursor, beforeCursor)
    ).toBeGreaterThanOrEqual(0);
  }
}

describe('VfsBackgroundSyncClient', () => {
  it('converges multiple clients after concurrent flush and sync', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 20,
      pullDelayMs: 10
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 5,
      pullDelayMs: 15
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      {
        pullLimit: 2
      }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T12:00:02.000Z'
    });

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T12:00:03.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T12:00:04.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush()]);
    await Promise.all([desktop.sync(), mobile.sync()]);

    const serverSnapshot = server.snapshot();
    const desktopSnapshot = desktop.snapshot();
    const mobileSnapshot = mobile.snapshot();

    expect(desktopSnapshot.pendingOperations).toBe(0);
    expect(mobileSnapshot.pendingOperations).toBe(0);
    expect(desktopSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(desktopSnapshot.links).toEqual(serverSnapshot.links);
    expect(mobileSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(mobileSnapshot.links).toEqual(serverSnapshot.links);
    expect(desktopSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(mobileSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );

    expect(desktopSnapshot.containerClocks).toEqual([
      {
        containerId: 'item-1',
        changedAt: '2026-02-14T12:00:01.000Z',
        changeId: 'mobile-1'
      },
      {
        containerId: 'root',
        changedAt: '2026-02-14T12:00:04.000Z',
        changeId: 'mobile-3'
      }
    ]);

    const firstContainerPage = desktop.listChangedContainers(null, 1);
    expect(firstContainerPage.items).toEqual([
      {
        containerId: 'item-1',
        changedAt: '2026-02-14T12:00:01.000Z',
        changeId: 'mobile-1'
      }
    ]);
    expect(firstContainerPage.hasMore).toBe(true);
    expect(firstContainerPage.nextCursor).toEqual({
      changedAt: '2026-02-14T12:00:01.000Z',
      changeId: 'mobile-1'
    });

    const secondContainerPage = desktop.listChangedContainers(
      firstContainerPage.nextCursor,
      1
    );
    expect(secondContainerPage.items).toEqual([
      {
        containerId: 'root',
        changedAt: '2026-02-14T12:00:04.000Z',
        changeId: 'mobile-3'
      }
    ]);
    expect(secondContainerPage.hasMore).toBe(false);
  });

  it('rejects queued link operations whose childId does not match itemId', () => {
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer())
    );

    expect(() =>
      client.queueLocalOperation({
        opType: 'link_add',
        itemId: 'item-1',
        parentId: 'root',
        childId: 'item-2',
        occurredAt: '2026-02-14T12:00:05.000Z'
      })
    ).toThrowError(/childId must match itemId/);
  });

  it('coalesces concurrent flush calls and keeps queue on push failure', async () => {
    let pushAttempts = 0;
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new Error('transient push failure');
        }

        return {
          results: input.operations.map((operation) => ({
            opId: operation.opId,
            status: 'applied'
          }))
        };
      },
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
      occurredAt: '2026-02-14T12:01:00.000Z'
    });

    const [firstFlush, secondFlush] = await Promise.allSettled([
      client.flush(),
      client.flush()
    ]);

    expect(firstFlush.status).toBe('rejected');
    expect(secondFlush.status).toBe('rejected');
    expect(pushAttempts).toBe(1);
    expect(client.snapshot().pendingOperations).toBe(1);

    const retryFlush = await client.flush();
    expect(retryFlush).toEqual({
      pushedOperations: 1,
      pulledOperations: 0,
      pullPages: 1
    });
    expect(pushAttempts).toBe(2);
    expect(client.snapshot().pendingOperations).toBe(0);
  });

  it('retries in background and drains queue after transient errors', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const errors: unknown[] = [];
    let pushAttempts = 0;
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new Error('temporary network issue');
        }

        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onBackgroundError: (error) => {
        errors.push(error);
      }
    });

    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:02:00.000Z'
    });

    client.startBackgroundFlush(10);
    await waitFor(() => client.snapshot().pendingOperations === 0, 1000);
    await client.stopBackgroundFlush();

    expect(errors.length).toBeGreaterThan(0);
    expect(client.snapshot().acl).toEqual(server.snapshot().acl);
    expect(client.snapshot().pendingOperations).toBe(0);
  });

  it('rejects invalid background flush intervals', () => {
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer())
    );

    expect(() => client.startBackgroundFlush(0)).toThrowError(
      /positive integer/
    );
    expect(() => client.startBackgroundFlush(-1)).toThrowError(
      /positive integer/
    );
    expect(() => client.startBackgroundFlush(1.5)).toThrowError(
      /positive integer/
    );
  });

  it('keeps background flush start idempotent with a single active timer', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );

    client.startBackgroundFlush(10);
    client.startBackgroundFlush(10);

    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-start-idempotent-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:02:03.000Z'
    });
    await waitFor(() => client.snapshot().pendingOperations === 0, 1000);

    await client.stopBackgroundFlush();

    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-start-idempotent-2',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:02:04.000Z'
    });

    await wait(50);
    expect(client.snapshot().pendingOperations).toBe(1);
  });

  it('converges staggered background flush clients under concurrent writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 9,
        pullDelayMs: 4
      }),
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 3,
        pullDelayMs: 11
      }),
      { pullLimit: 1 }
    );
    const tablet = new VfsBackgroundSyncClient(
      'user-1',
      'tablet',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 6,
        pullDelayMs: 6
      }),
      { pullLimit: 3 }
    );
    const clients = [desktop, mobile, tablet];

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:05:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-a',
      parentId: 'root',
      childId: 'item-a',
      occurredAt: '2026-02-14T12:05:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:05:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-a',
      parentId: 'root',
      childId: 'item-a',
      occurredAt: '2026-02-14T12:05:03.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-b',
      parentId: 'root',
      childId: 'item-b',
      occurredAt: '2026-02-14T12:05:04.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T12:05:05.000Z'
    });

    desktop.startBackgroundFlush(9);
    mobile.startBackgroundFlush(13);
    tablet.startBackgroundFlush(7);
    try {
      await waitFor(
        () =>
          clients.every((client) => client.snapshot().pendingOperations === 0),
        3000
      );
    } finally {
      await Promise.all(clients.map((client) => client.stopBackgroundFlush()));
    }

    await Promise.all(clients.map((client) => client.sync()));

    const serverSnapshot = server.snapshot();
    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 2,
      tablet: 2
    });

    for (const client of clients) {
      const snapshot = client.snapshot();
      expect(snapshot.pendingOperations).toBe(0);
      expect(snapshot.acl).toEqual(serverSnapshot.acl);
      expect(snapshot.links).toEqual(serverSnapshot.links);
      expect(snapshot.lastReconciledWriteIds).toEqual(
        serverSnapshot.lastReconciledWriteIds
      );
    }
  });

  it('stopBackgroundFlush(false) returns before in-flight flush settles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releasePush: (() => void) | null = null;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await pushGate;
        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stop-nowait',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:02:01.000Z'
    });

    client.startBackgroundFlush(5);
    await waitFor(() => pushStarted, 1000);

    await client.stopBackgroundFlush(false);
    expect(client.snapshot().pendingOperations).toBe(1);

    if (!releasePush) {
      throw new Error('missing push release hook');
    }
    releasePush();
    await waitFor(() => client.snapshot().pendingOperations === 0, 1000);
  });

  it('stopBackgroundFlush() waits for in-flight flush by default', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releasePush: (() => void) | null = null;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await pushGate;
        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stop-wait',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:02:02.000Z'
    });

    client.startBackgroundFlush(5);
    await waitFor(() => pushStarted, 1000);

    let stopCompleted = false;
    const stopPromise = client.stopBackgroundFlush().then(() => {
      stopCompleted = true;
    });

    await wait(20);
    expect(stopCompleted).toBe(false);
    expect(client.snapshot().pendingOperations).toBe(1);

    if (!releasePush) {
      throw new Error('missing push release hook');
    }
    releasePush();

    await stopPromise;
    expect(client.snapshot().pendingOperations).toBe(0);
  });

  it('fails closed when transport cursor metadata disagrees with page tail', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-1',
            occurredAt: '2026-02-14T12:03:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:03:01.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {}
      })
    };
    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);

    await expect(client.sync()).rejects.toThrowError(
      /nextCursor that does not match pull page tail/
    );
  });

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

  it('converges deterministic randomized concurrent io across three clients', async () => {
    /**
     * Guardrail: this seeded stress scenario is intentionally non-trivial so we
     * exercise interleavings of queue/flush/sync across multiple clients, but
     * deterministic so any regression is reproducible by seed.
     */
    const random = createDeterministicRandom(1220);
    const server = new InMemoryVfsCrdtSyncServer();
    const canonicalClock = {
      currentMs: Date.parse('2026-02-14T00:00:00.000Z')
    };
    const clientIds = ['desktop', 'mobile', 'tablet'] as const;
    const clients = clientIds.map(
      (clientId) =>
        new VfsBackgroundSyncClient(
          'user-1',
          clientId,
          createDeterministicJitterTransport({
            server,
            random,
            maxDelayMs: 4,
            canonicalClock
          }),
          {
            pullLimit: nextInt(random, 1, 3)
          }
        )
    );

    const itemIds = ['item-1', 'item-2', 'item-3', 'item-4'] as const;
    const parentIds = ['root', 'folder-1', 'folder-2'] as const;
    const principalTypes = ['group', 'organization', 'user'] as const;
    const principalIds = ['group-1', 'org-1', 'user-2'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    let occurredAtMs = Date.parse('2026-02-14T13:00:00.000Z');
    const nextOccurredAt = (): string => {
      const value = new Date(occurredAtMs).toISOString();
      occurredAtMs += 1000;
      return value;
    };

    for (let round = 0; round < 60; round++) {
      const actor = pickOne(clients, random);
      const peer = pickDifferent(clients, actor, random);
      const itemId = pickOne(itemIds, random);
      const operationVariant = nextInt(random, 0, 3);
      if (operationVariant === 0) {
        actor.queueLocalOperation({
          opType: 'acl_add',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          accessLevel: pickOne(accessLevels, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 1) {
        actor.queueLocalOperation({
          opType: 'acl_remove',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 2) {
        actor.queueLocalOperation({
          opType: 'link_add',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      } else {
        actor.queueLocalOperation({
          opType: 'link_remove',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      }

      const actionVariant = nextInt(random, 0, 5);
      if (actionVariant === 0) {
        await Promise.all([actor.flush(), peer.sync()]);
      } else if (actionVariant === 1) {
        await Promise.all([actor.sync(), peer.flush()]);
      } else if (actionVariant === 2) {
        await Promise.all([actor.flush(), peer.flush()]);
      } else if (actionVariant === 3) {
        await Promise.all([actor.sync(), peer.sync()]);
      } else if (actionVariant === 4) {
        await actor.flush();
      } else {
        await actor.sync();
      }
    }
    await Promise.all(clients.map((client) => client.flush()));
    for (let index = 0; index < 3; index++) {
      await Promise.all(clients.map((client) => client.sync()));
    }

    const serverSnapshot = server.snapshot();
    const baseClientSnapshot = clients[0].snapshot();

    for (const client of clients) {
      const snapshot = client.snapshot();
      expect(snapshot.pendingOperations).toBe(0);
      expect(snapshot.acl).toEqual(serverSnapshot.acl);
      expect(snapshot.links).toEqual(serverSnapshot.links);
      expect(snapshot.lastReconciledWriteIds).toEqual(
        serverSnapshot.lastReconciledWriteIds
      );
      expect(snapshot.containerClocks).toEqual(
        baseClientSnapshot.containerClocks
      );
    }

    for (let index = 0; index < clientIds.length; index++) {
      const clientId = clientIds[index];
      const client = clients[index];
      if (!client) {
        throw new Error(`missing client for replica ${clientId}`);
      }

      const replicaWriteId =
        serverSnapshot.lastReconciledWriteIds[clientId] ?? 0;
      expect(client.snapshot().nextLocalWriteId).toBeGreaterThanOrEqual(
        replicaWriteId + 1
      );
    }
  });

  it('converges deterministic randomized io with in-loop restart hydration', async () => {
    /**
     * Guardrail stress harness:
     * - deterministic randomized interleavings for reproducibility
     * - process-restart simulation in-loop via exportState/hydrateState
     * - replay cursor monotonicity checks after every step
     */
    const random = createDeterministicRandom(1221);
    const server = new InMemoryVfsCrdtSyncServer();
    const canonicalClock = {
      currentMs: Date.parse('2026-02-14T00:30:00.000Z')
    };
    const clientIds = ['desktop', 'mobile', 'tablet'] as const;

    const pullLimitByClient = new Map<string, number>();
    const transportByClient = new Map<string, VfsCrdtSyncTransport>();
    const clientsByClient = new Map<string, VfsBackgroundSyncClient>();
    for (const clientId of clientIds) {
      pullLimitByClient.set(clientId, nextInt(random, 1, 3));
      transportByClient.set(
        clientId,
        createDeterministicJitterTransport({
          server,
          random,
          maxDelayMs: 4,
          canonicalClock
        })
      );
    }

    const createClient = (clientId: string): VfsBackgroundSyncClient => {
      const transport = transportByClient.get(clientId);
      if (!transport) {
        throw new Error(`missing transport for replica ${clientId}`);
      }
      const pullLimit = pullLimitByClient.get(clientId);
      if (!pullLimit) {
        throw new Error(`missing pull limit for replica ${clientId}`);
      }

      return new VfsBackgroundSyncClient('user-1', clientId, transport, {
        pullLimit
      });
    };

    const getClient = (clientId: string): VfsBackgroundSyncClient => {
      const client = clientsByClient.get(clientId);
      if (!client) {
        throw new Error(`missing client for replica ${clientId}`);
      }

      return client;
    };

    for (const clientId of clientIds) {
      clientsByClient.set(clientId, createClient(clientId));
    }

    const lastReplayCursorByClient = new Map<
      string,
      { changedAt: string; changeId: string }
    >();
    const restartCursorFloorByClient = new Map<
      string,
      { changedAt: string; changeId: string }
    >();
    let restartHydrateCount = 0;
    let restartFloorChecks = 0;
    const assertReplayCursorMonotonic = (clientId: string): void => {
      const cursor = getClient(clientId).exportState().replaySnapshot.cursor;
      const previousCursor = lastReplayCursorByClient.get(clientId);
      const restartFloorCursor = restartCursorFloorByClient.get(clientId);

      if (previousCursor && !cursor) {
        throw new Error(`replay cursor regressed to null for ${clientId}`);
      }

      if (previousCursor && cursor) {
        expect(
          compareVfsSyncCursorOrder(cursor, previousCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      if (restartFloorCursor && cursor) {
        restartFloorChecks += 1;
        expect(
          compareVfsSyncCursorOrder(cursor, restartFloorCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      if (cursor) {
        lastReplayCursorByClient.set(clientId, {
          changedAt: cursor.changedAt,
          changeId: cursor.changeId
        });
      }
    };

    const itemIds = ['item-r1', 'item-r2', 'item-r3', 'item-r4'] as const;
    const parentIds = ['root', 'folder-r1', 'folder-r2'] as const;
    const principalTypes = ['group', 'organization', 'user'] as const;
    const principalIds = ['group-r1', 'org-r1', 'user-r2'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    let occurredAtMs = Date.parse('2026-02-14T13:30:00.000Z');
    const nextOccurredAt = (): string => {
      const value = new Date(occurredAtMs).toISOString();
      occurredAtMs += 1000;
      return value;
    };

    for (let round = 0; round < 55; round++) {
      if (nextInt(random, 0, 7) === 0) {
        const restartClientId = pickOne(clientIds, random);
        const restartClient = getClient(restartClientId);
        /**
         * Guardrail: this scenario targets replay-cursor monotonicity under
         * restart churn, so only restart quiescent replicas to avoid conflating
         * cursor regressions with pending-write transport timing.
         */
        if (restartClient.snapshot().pendingOperations === 0) {
          const persistedState = restartClient.exportState();
          const persistedCursor = persistedState.replaySnapshot.cursor;
          if (persistedCursor) {
            const existingFloor =
              restartCursorFloorByClient.get(restartClientId);
            if (
              !existingFloor ||
              compareVfsSyncCursorOrder(persistedCursor, existingFloor) > 0
            ) {
              restartCursorFloorByClient.set(restartClientId, {
                changedAt: persistedCursor.changedAt,
                changeId: persistedCursor.changeId
              });
            }
          }
          const restartedClient = createClient(restartClientId);
          restartedClient.hydrateState(persistedState);
          clientsByClient.set(restartClientId, restartedClient);
          restartHydrateCount += 1;
          assertReplayCursorMonotonic(restartClientId);
        }
      }

      const activeClients = clientIds.map((clientId) => getClient(clientId));
      const actor = pickOne(activeClients, random);
      const peer = pickDifferent(activeClients, actor, random);
      const itemId = pickOne(itemIds, random);
      const operationVariant = nextInt(random, 0, 3);
      if (operationVariant === 0) {
        actor.queueLocalOperation({
          opType: 'acl_add',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          accessLevel: pickOne(accessLevels, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 1) {
        actor.queueLocalOperation({
          opType: 'acl_remove',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 2) {
        actor.queueLocalOperation({
          opType: 'link_add',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      } else {
        actor.queueLocalOperation({
          opType: 'link_remove',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      }

      const actionVariant = nextInt(random, 0, 5);
      if (actionVariant === 0) {
        await Promise.all([actor.flush(), peer.sync()]);
      } else if (actionVariant === 1) {
        await Promise.all([actor.sync(), peer.flush()]);
      } else if (actionVariant === 2) {
        await Promise.all([actor.flush(), peer.flush()]);
      } else if (actionVariant === 3) {
        await Promise.all([actor.sync(), peer.sync()]);
      } else if (actionVariant === 4) {
        await actor.flush();
      } else {
        await actor.sync();
      }

      for (const clientId of clientIds) {
        assertReplayCursorMonotonic(clientId);
      }
    }

    if (restartHydrateCount === 0) {
      const forcedRestartClientId = 'desktop';
      const forcedRestartClient = getClient(forcedRestartClientId);
      await forcedRestartClient.flush();
      const persistedState = forcedRestartClient.exportState();
      const persistedCursor = persistedState.replaySnapshot.cursor;
      if (persistedCursor) {
        restartCursorFloorByClient.set(forcedRestartClientId, {
          changedAt: persistedCursor.changedAt,
          changeId: persistedCursor.changeId
        });
      }
      const restartedClient = createClient(forcedRestartClientId);
      restartedClient.hydrateState(persistedState);
      clientsByClient.set(forcedRestartClientId, restartedClient);
      restartHydrateCount += 1;
      assertReplayCursorMonotonic(forcedRestartClientId);
    }

    expect(restartHydrateCount).toBeGreaterThan(0);
    expect(restartFloorChecks).toBeGreaterThan(0);

    const finalClients = clientIds.map((clientId) => getClient(clientId));
    await Promise.all(finalClients.map((client) => client.flush()));
    for (let index = 0; index < 8; index++) {
      await Promise.all(finalClients.map((client) => client.sync()));
    }

    for (const clientId of clientIds) {
      const snapshot = getClient(clientId).snapshot();
      expect(snapshot.pendingOperations).toBe(0);
      const replicaWriteId = snapshot.lastReconciledWriteIds[clientId] ?? 0;
      expect(snapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
        replicaWriteId + 1
      );
    }
  });

  it('restores persisted state and converges after restart with concurrent updates', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 10,
      pullDelayMs: 4
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 8
    });
    const observerTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 1
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );
    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      observerTransport,
      { pullLimit: 3 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:00:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-2',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T13:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-2',
      parentId: 'root',
      childId: 'item-2',
      occurredAt: '2026-02-14T13:00:01.000Z'
    });

    const persistedDesktopState = desktop.exportState();

    /**
     * Guardrail scenario: simulate process restart by constructing a new client
     * instance and hydrating persisted state before any network activity.
     */
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T14:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:00:02.000Z'
    });

    await Promise.all([mobile.flush(), resumedDesktop.flush()]);
    await Promise.all([mobile.sync(), resumedDesktop.sync(), observer.sync()]);

    const serverSnapshot = server.snapshot();
    const resumedSnapshot = resumedDesktop.snapshot();
    const observerSnapshot = observer.snapshot();

    expect(resumedSnapshot.pendingOperations).toBe(0);
    expect(resumedSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(resumedSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(observerSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(observerSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
      (serverSnapshot.lastReconciledWriteIds['desktop'] ?? 0) + 1
    );
  });

  it('fails closed when hydrated pending operations reference another replica', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const persisted = client.exportState();
    persisted.pendingOperations = [
      {
        opId: 'mobile-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T14:10:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /replicaId that does not match clientId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has replicaId that does not match clientId'
    });
  });

  it('fails closed when hydrated link pending operation has mismatched childId', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const persisted = client.exportState();
    persisted.pendingOperations = [
      {
        opId: 'desktop-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T14:11:00.000Z',
        parentId: 'root',
        childId: 'item-2'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /childId that does not match itemId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has link childId that does not match itemId'
    });
  });

  it('fails closed when hydrated replay cursor is malformed and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.replaySnapshot.cursor = {
      changedAt: 'not-a-date',
      changeId: 'desktop-1'
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /invalid persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'transport returned invalid persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated reconcile write ids are invalid and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:12:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 0
      }
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /invalid writeId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrating while background flush is active', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    const persisted = client.exportState();
    client.startBackgroundFlush(50);

    expect(() => client.hydrateState(persisted)).toThrowError(
      /background flush is active/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while background flush is active'
    });

    await client.stopBackgroundFlush(false);
  });

  it('fails closed when hydrating while flush is in progress', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releasePush: (() => void) | null = null;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await pushGate;
        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
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
      itemId: 'item-hydrate-flush',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:21:00.000Z'
    });

    const flushPromise = client.flush();
    await waitFor(() => pushStarted, 1000);

    const stateBeforeHydrate = client.exportState();
    const persisted = client.exportState();
    expect(() => client.hydrateState(persisted)).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });
    expect(client.exportState()).toEqual(stateBeforeHydrate);

    if (!releasePush) {
      throw new Error('missing push release hook');
    }
    releasePush();
    await flushPromise;
    expect(client.snapshot().pendingOperations).toBe(0);
  });

  it('preserves cross-client convergence after hydrate rejection during in-flight flush', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releaseDesktopPush: (() => void) | null = null;
    const desktopPushGate = new Promise<void>((resolve) => {
      releaseDesktopPush = resolve;
    });

    const desktopTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await desktopPushGate;
        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 2
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-desktop',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:22:02.000Z'
    });
    const desktopFlushPromise = desktop.flush();
    await waitFor(() => pushStarted, 1000);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mobile',
      parentId: 'root',
      childId: 'item-mobile',
      occurredAt: '2026-02-14T14:22:01.000Z'
    });
    await mobile.flush();
    await mobile.sync();
    const mobileSnapshotBeforeDesktopResume = mobile.snapshot();

    const desktopStateBeforeHydrate = desktop.exportState();
    const desktopPersisted = desktop.exportState();
    expect(() => desktop.hydrateState(desktopPersisted)).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });
    expect(desktop.exportState()).toEqual(desktopStateBeforeHydrate);

    if (!releaseDesktopPush) {
      throw new Error('missing desktop push release hook');
    }
    releaseDesktopPush();
    await desktopFlushPromise;
    for (let index = 0; index < 3; index++) {
      await Promise.all([desktop.sync(), mobile.sync()]);
    }

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
    expectContainerClocksMonotonic(
      desktopStateBeforeHydrate.containerClocks,
      desktopSnapshot.containerClocks
    );
    expectContainerClocksMonotonic(
      mobileSnapshotBeforeDesktopResume.containerClocks,
      mobileSnapshot.containerClocks
    );
  });

  it('keeps listChangedContainers pagination forward-only after hydrate rejection race', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releaseDesktopPush: (() => void) | null = null;
    const desktopPushGate = new Promise<void>((resolve) => {
      releaseDesktopPush = resolve;
    });

    const desktopTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await desktopPushGate;
        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 2
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:24:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const baselinePage = desktop.listChangedContainers(null, 1);
    const baselineCursor = baselinePage.nextCursor;
    if (!baselineCursor) {
      throw new Error('expected baseline container cursor');
    }

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-desktop',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:24:02.000Z'
    });
    const desktopFlushPromise = desktop.flush();
    await waitFor(() => pushStarted, 1000);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mobile',
      parentId: 'root',
      childId: 'item-mobile',
      occurredAt: '2026-02-14T14:24:01.000Z'
    });
    await mobile.flush();
    await mobile.sync();

    expect(() => desktop.hydrateState(desktop.exportState())).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });

    if (!releaseDesktopPush) {
      throw new Error('missing desktop push release hook');
    }
    releaseDesktopPush();
    await desktopFlushPromise;

    for (let index = 0; index < 3; index++) {
      await Promise.all([desktop.sync(), mobile.sync()]);
    }

    const firstPageAfterBaseline = desktop.listChangedContainers(
      baselineCursor,
      1
    );
    expect(firstPageAfterBaseline.items.length).toBe(1);
    const firstCursor = firstPageAfterBaseline.nextCursor;
    if (!firstCursor) {
      throw new Error('expected pagination cursor after first forward page');
    }
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: firstPageAfterBaseline.items[0]?.changedAt ?? '',
          changeId: firstPageAfterBaseline.items[0]?.changeId ?? ''
        },
        baselineCursor
      )
    ).toBeGreaterThan(0);

    const secondPageAfterBaseline = desktop.listChangedContainers(
      firstCursor,
      10
    );
    for (const item of secondPageAfterBaseline.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          firstCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('preserves container-clock pagination boundaries across export and hydrate restart', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 4,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 5
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-rt-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:25:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-rt-2',
      parentId: 'root',
      childId: 'item-rt-2',
      occurredAt: '2026-02-14T14:25:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const firstPageBefore = desktop.listChangedContainers(null, 1);
    const secondPageBefore = desktop.listChangedContainers(
      firstPageBefore.nextCursor,
      1
    );
    const thirdPageBefore = desktop.listChangedContainers(
      secondPageBefore.nextCursor,
      10
    );

    const persistedState = desktop.exportState();
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedState);

    const firstPageAfter = resumedDesktop.listChangedContainers(null, 1);
    const secondPageAfter = resumedDesktop.listChangedContainers(
      firstPageAfter.nextCursor,
      1
    );
    const thirdPageAfter = resumedDesktop.listChangedContainers(
      secondPageAfter.nextCursor,
      10
    );

    expect(firstPageAfter).toEqual(firstPageBefore);
    expect(secondPageAfter).toEqual(secondPageBefore);
    expect(thirdPageAfter).toEqual(thirdPageBefore);
  });

  it('returns only strictly newer container clocks when reusing pre-restart cursor', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:26:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:26:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const initialPage = desktop.listChangedContainers(null, 10);
    const seedCursor = initialPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected pre-restart seed cursor');
    }

    const persistedState = desktop.exportState();
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedState);

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:26:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const pageAfterRestart = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(pageAfterRestart.items.length).toBeGreaterThan(0);
    expect(pageAfterRestart.items).toContainEqual({
      containerId: 'item-seed-c',
      changedAt: '2026-02-14T14:26:02.000Z',
      changeId: 'mobile-3'
    });

    for (const item of pageAfterRestart.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('returns stable empty pages when reusing pre-restart cursor with no new writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stable-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:27:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stable-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:27:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const initialPage = desktop.listChangedContainers(null, 10);
    const seedCursor = initialPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected pre-restart seed cursor');
    }

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const firstEmptyPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    const secondEmptyPage = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );

    expect(firstEmptyPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });
    expect(secondEmptyPage).toEqual(firstEmptyPage);
  });

  it('transitions pre-restart cursor from stable-empty to strict-forward after new writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hybrid-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:28:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hybrid-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:28:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const initialPage = desktop.listChangedContainers(null, 10);
    const seedCursor = initialPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected pre-restart seed cursor');
    }

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const emptyPageAfterHydrate = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(emptyPageAfterHydrate).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hybrid-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:28:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPageAfterWrite = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(forwardPageAfterWrite.items.length).toBeGreaterThan(0);
    expect(forwardPageAfterWrite.items).toContainEqual({
      containerId: 'item-hybrid-c',
      changedAt: '2026-02-14T14:28:02.000Z',
      changeId: 'mobile-3'
    });

    for (const item of forwardPageAfterWrite.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('transitions link-driven parent container cursor from stable-empty to strict-forward after restart', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-link-a',
      parentId: 'root',
      childId: 'item-link-a',
      occurredAt: '2026-02-14T14:29:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const rootSeedPage = desktop.listChangedContainers(null, 10);
    const rootSeedEntry = rootSeedPage.items.find(
      (entry) => entry.containerId === 'root'
    );
    if (!rootSeedEntry) {
      throw new Error('expected root container clock seed entry');
    }
    const rootSeedCursor = {
      changedAt: rootSeedEntry.changedAt,
      changeId: rootSeedEntry.changeId
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const emptyRootPage = resumedDesktop.listChangedContainers(
      rootSeedCursor,
      10
    );
    expect(emptyRootPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-link-a',
      parentId: 'root',
      childId: 'item-link-a',
      occurredAt: '2026-02-14T14:29:01.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardRootPage = resumedDesktop.listChangedContainers(
      rootSeedCursor,
      10
    );
    expect(forwardRootPage.items.length).toBeGreaterThan(0);
    expect(forwardRootPage.items).toContainEqual({
      containerId: 'root',
      changedAt: '2026-02-14T14:29:01.000Z',
      changeId: 'mobile-2'
    });

    for (const item of forwardRootPage.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          rootSeedCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('reused mixed acl+link cursor excludes boundary rows and returns strict-forward updates', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-mix-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:30:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mix-link',
      parentId: 'root',
      childId: 'item-mix-link',
      occurredAt: '2026-02-14T14:30:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const seedPage = desktop.listChangedContainers(null, 10);
    const seedCursor = seedPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected mixed pre-restart seed cursor');
    }

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const emptyPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    expect(emptyPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-mix-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:30:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-mix-link',
      parentId: 'root',
      childId: 'item-mix-link',
      occurredAt: '2026-02-14T14:30:03.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    expect(forwardPage.items).toContainEqual({
      containerId: 'item-mix-b',
      changedAt: '2026-02-14T14:30:02.000Z',
      changeId: 'mobile-3'
    });
    expect(forwardPage.items).toContainEqual({
      containerId: 'root',
      changedAt: '2026-02-14T14:30:03.000Z',
      changeId: 'mobile-4'
    });

    for (const item of forwardPage.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
      expect(item.changeId).not.toBe(seedCursor.changeId);
    }
  });

  it('reuses replay cursor across restart without boundary replay in mixed acl+link pull stream', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:31:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-replay-a',
      parentId: 'root',
      childId: 'item-replay-a',
      occurredAt: '2026-02-14T14:31:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = persistedDesktopState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected mixed pre-restart replay seed cursor');
    }

    const observedPulls: Array<{
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    const baseDesktopTransport: VfsCrdtSyncTransport = desktopTransport;
    const observingDesktopTransport: VfsCrdtSyncTransport = {
      pushOperations: (input) => baseDesktopTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseDesktopTransport.pullOperations(input);
        observedPulls.push({
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: baseDesktopTransport.reconcileState
        ? (input) => baseDesktopTransport.reconcileState(input)
        : undefined
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      observingDesktopTransport,
      { pullLimit: 1 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    /**
     * Guardrail invariant: when no writes were appended after restart, the first
     * pull must replay from the persisted boundary cursor and return an empty
     * page, preserving cursor idempotence across restart.
     */
    await resumedDesktop.sync();
    expect(observedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(observedPulls[0]?.items).toEqual([]);

    const pullsBeforeNewWrites = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:31:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-replay-a',
      parentId: 'root',
      childId: 'item-replay-a',
      occurredAt: '2026-02-14T14:31:03.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPulls = observedPulls.slice(pullsBeforeNewWrites);
    expect(forwardPulls.length).toBeGreaterThan(0);
    expect(forwardPulls[0]?.requestCursor).toEqual(seedReplayCursor);

    /**
     * Guardrail invariant: the same pre-restart cursor boundary must remain
     * strictly forward-only once new writes appear, even when ACL and link
     * operations are interleaved in the canonical feed.
     */
    const forwardItems = forwardPulls.flatMap((page) => page.items);
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-3',
        opType: 'acl_add',
        itemId: 'item-replay-b'
      })
    );
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-4',
        opType: 'link_remove',
        itemId: 'item-replay-a'
      })
    );
    expect(forwardItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of forwardItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          seedReplayCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('keeps replay cursor strict-forward across restart with concurrent multi-replica writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });
    const tabletTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 5
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );
    const tablet = new VfsBackgroundSyncClient(
      'user-1',
      'tablet',
      tabletTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-concurrent-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:32:00.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-replay-concurrent-b',
      parentId: 'root',
      childId: 'item-replay-concurrent-b',
      occurredAt: '2026-02-14T14:32:01.000Z'
    });
    await Promise.all([mobile.flush(), tablet.flush()]);
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = persistedDesktopState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected multi-replica pre-restart replay seed cursor');
    }

    const observedPulls: Array<{
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    const baseDesktopTransport: VfsCrdtSyncTransport = desktopTransport;
    const observingDesktopTransport: VfsCrdtSyncTransport = {
      pushOperations: (input) => baseDesktopTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseDesktopTransport.pullOperations(input);
        observedPulls.push({
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: baseDesktopTransport.reconcileState
        ? (input) => baseDesktopTransport.reconcileState(input)
        : undefined
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      observingDesktopTransport,
      { pullLimit: 1 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    /**
     * Guardrail invariant: reused replay cursor must remain idempotent across
     * restart before new canonical-feed writes are appended.
     */
    await resumedDesktop.sync();
    expect(observedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(observedPulls[0]?.items).toEqual([]);

    const pullsBeforeNewWrites = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-concurrent-c',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:32:02.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-replay-concurrent-b',
      parentId: 'root',
      childId: 'item-replay-concurrent-b',
      occurredAt: '2026-02-14T14:32:03.000Z'
    });
    await Promise.all([mobile.flush(), tablet.flush()]);
    await resumedDesktop.sync();

    const forwardPulls = observedPulls.slice(pullsBeforeNewWrites);
    expect(forwardPulls.length).toBeGreaterThanOrEqual(2);
    expect(forwardPulls[0]?.requestCursor).toEqual(seedReplayCursor);

    /**
     * Guardrail invariant: once concurrent replica writes land, all returned
     * page items must be strictly newer than the reused boundary cursor.
     */
    const forwardItems = forwardPulls.flatMap((page) => page.items);
    expect(forwardPulls[forwardPulls.length - 1]?.hasMore).toBe(false);

    for (let index = 0; index < forwardPulls.length; index++) {
      const page = forwardPulls[index];
      if (!page) {
        continue;
      }

      if (page.requestCursor) {
        expect(
          compareVfsSyncCursorOrder(page.requestCursor, seedReplayCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      const previousPage = index > 0 ? forwardPulls[index - 1] : null;
      if (previousPage?.nextCursor) {
        expect(page.requestCursor).toEqual(previousPage.nextCursor);
      }
    }

    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-2',
        opType: 'acl_add',
        itemId: 'item-replay-concurrent-c'
      })
    );
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-2',
        opType: 'link_remove',
        itemId: 'item-replay-concurrent-b'
      })
    );
    expect(forwardItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of forwardItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          seedReplayCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('keeps replay cursor monotonic across sequential post-restart sync cycles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:33:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = persistedDesktopState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected replay seed cursor before restart cycles');
    }

    const observedPulls: Array<{
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    const baseDesktopTransport: VfsCrdtSyncTransport = desktopTransport;
    const observingDesktopTransport: VfsCrdtSyncTransport = {
      pushOperations: (input) => baseDesktopTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseDesktopTransport.pullOperations(input);
        observedPulls.push({
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: baseDesktopTransport.reconcileState
        ? (input) => baseDesktopTransport.reconcileState(input)
        : undefined
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      observingDesktopTransport,
      { pullLimit: 1 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    /**
     * Guardrail invariant: immediately after restart, reused pre-restart cursor
     * remains idempotent with no writes appended.
     */
    await resumedDesktop.sync();
    expect(observedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(observedPulls[0]?.items).toEqual([]);

    const cycleOneStart = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-cycle-a',
      parentId: 'root',
      childId: 'item-cycle-a',
      occurredAt: '2026-02-14T14:33:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:33:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleOnePulls = observedPulls.slice(cycleOneStart);
    expect(cycleOnePulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleOnePulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(cycleOnePulls[cycleOnePulls.length - 1]?.hasMore).toBe(false);

    const cycleOneItems = cycleOnePulls.flatMap((page) => page.items);
    for (const item of cycleOneItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          seedReplayCursor
        )
      ).toBeGreaterThan(0);
    }

    const cycleOneTerminalCursor =
      cycleOnePulls[cycleOnePulls.length - 1]?.nextCursor;
    expect(cycleOneTerminalCursor).not.toBeNull();
    if (!cycleOneTerminalCursor) {
      throw new Error('expected cycle one terminal cursor');
    }

    const cycleTwoStart = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-cycle-a',
      parentId: 'root',
      childId: 'item-cycle-a',
      occurredAt: '2026-02-14T14:33:03.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:33:04.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleTwoPulls = observedPulls.slice(cycleTwoStart);
    expect(cycleTwoPulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleTwoPulls[0]?.requestCursor).toEqual(cycleOneTerminalCursor);
    expect(cycleTwoPulls[cycleTwoPulls.length - 1]?.hasMore).toBe(false);

    /**
     * Guardrail invariant: each new sync cycle must advance strictly past the
     * terminal cursor of the prior cycle with no boundary row replay.
     */
    const cycleTwoItems = cycleTwoPulls.flatMap((page) => page.items);
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      cycleOneTerminalCursor.changeId
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of cycleTwoItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          cycleOneTerminalCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('keeps replay cursor monotonic across sequential replica handoff cycles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });
    const tabletTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 5
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );
    const tablet = new VfsBackgroundSyncClient(
      'user-1',
      'tablet',
      tabletTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:34:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = persistedDesktopState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected replay seed cursor before handoff cycles');
    }

    const observedPulls: Array<{
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    const baseDesktopTransport: VfsCrdtSyncTransport = desktopTransport;
    const observingDesktopTransport: VfsCrdtSyncTransport = {
      pushOperations: (input) => baseDesktopTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseDesktopTransport.pullOperations(input);
        observedPulls.push({
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: baseDesktopTransport.reconcileState
        ? (input) => baseDesktopTransport.reconcileState(input)
        : undefined
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      observingDesktopTransport,
      { pullLimit: 1 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);
    await resumedDesktop.sync();
    expect(observedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(observedPulls[0]?.items).toEqual([]);

    const cycleOneStart = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-handoff-a',
      parentId: 'root',
      childId: 'item-handoff-a',
      occurredAt: '2026-02-14T14:34:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:34:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleOnePulls = observedPulls.slice(cycleOneStart);
    expect(cycleOnePulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleOnePulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(cycleOnePulls[cycleOnePulls.length - 1]?.hasMore).toBe(false);

    const cycleOneItems = cycleOnePulls.flatMap((page) => page.items);
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-2',
        opType: 'link_add',
        itemId: 'item-handoff-a'
      })
    );
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-3',
        opType: 'acl_add',
        itemId: 'item-handoff-b'
      })
    );

    const cycleOneTerminalCursor =
      cycleOnePulls[cycleOnePulls.length - 1]?.nextCursor;
    expect(cycleOneTerminalCursor).not.toBeNull();
    if (!cycleOneTerminalCursor) {
      throw new Error('expected cycle one handoff terminal cursor');
    }

    const cycleTwoStart = observedPulls.length;

    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-handoff-c',
      parentId: 'root',
      childId: 'item-handoff-c',
      occurredAt: '2026-02-14T14:34:03.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:34:04.000Z'
    });
    await tablet.flush();
    await resumedDesktop.sync();

    const cycleTwoPulls = observedPulls.slice(cycleTwoStart);
    expect(cycleTwoPulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleTwoPulls[0]?.requestCursor).toEqual(cycleOneTerminalCursor);
    expect(cycleTwoPulls[cycleTwoPulls.length - 1]?.hasMore).toBe(false);

    /**
     * Guardrail invariant: switching write source replicas across cycles must
     * not reset cursor progression or replay prior cycle boundary rows.
     */
    const cycleTwoItems = cycleTwoPulls.flatMap((page) => page.items);
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-1',
        opType: 'link_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-2',
        opType: 'acl_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      cycleOneTerminalCursor.changeId
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of cycleTwoItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          cycleOneTerminalCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('fails closed when hydrating on a non-empty client state', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:20:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );

    await client.sync();
    const stateBeforeHydrate = client.exportState();
    const persisted = client.exportState();

    expect(() => client.hydrateState(persisted)).toThrowError(
      /non-empty client/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state on a non-empty client'
    });
    expect(client.exportState()).toEqual(stateBeforeHydrate);
  });

  it('drains queue after idempotent retry when first push fails post-commit', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    let firstAttempt = true;

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        if (firstAttempt) {
          firstAttempt = false;
          await server.pushOperations({
            operations: input.operations
          });
          throw new Error('connection dropped after commit');
        }

        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:11:00.000Z'
    });

    await expect(client.flush()).rejects.toThrowError(/connection dropped/);
    expect(client.snapshot().pendingOperations).toBe(1);

    const retry = await client.flush();
    expect(retry.pushedOperations).toBe(1);
    expect(client.snapshot().pendingOperations).toBe(0);
    expect(client.snapshot().acl).toEqual(server.snapshot().acl);
  });

  it('fails closed when transport push response is malformed', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
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
      occurredAt: '2026-02-14T12:12:00.000Z'
    });

    await expect(client.flush()).rejects.toThrowError(
      /mismatched push response/
    );
    expect(client.snapshot().pendingOperations).toBe(1);
  });

  it('fails closed when pull pages regress last reconciled write ids', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:13:00.000Z'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:13:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 2
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-2',
              occurredAt: '2026-02-14T12:13:01.000Z'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:13:01.000Z',
            changeId: 'desktop-2'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
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
    await expect(client.sync()).rejects.toThrowError(/regressed/);
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state'
    });
  });

  it('applies transport reconcile acknowledgements when supported', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-1',
            occurredAt: '2026-02-14T12:20:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:20:00.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:01.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2,
          mobile: 4
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    await client.sync();

    const snapshot = client.snapshot();
    expect(snapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:20:01.000Z',
      changeId: 'desktop-2'
    });
    expect(snapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 4
    });
    expect(snapshot.nextLocalWriteId).toBe(3);
  });

  it('fails closed when reconcile acknowledgement regresses cursor', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:21:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:21:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:59.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      })
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
    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'reconcileCursorRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed sync cursor'
    });
  });

  it('fails closed when reconcile acknowledgement regresses last write ids', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:22:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      })
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
    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state'
    });
  });

  it('fails closed when transport regresses cursor with no items', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:14:00.000Z'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:14:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:13:59.000Z',
            changeId: 'desktop-0'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
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
    await client.sync();
    await expect(client.sync()).rejects.toThrowError(/regressing sync cursor/);
    expect(guardrailViolations).toContainEqual({
      code: 'pullCursorRegression',
      stage: 'pull',
      message: 'pull response regressed local sync cursor'
    });
  });
});
