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

  it('fails closed when pull pagination replays a duplicate opId in one sync cycle', async () => {
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
                opId: 'desktop-dup-op',
                occurredAt: '2026-02-14T12:03:00.000Z',
                itemId: 'item-first-page'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:03:00.000Z',
              changeId: 'desktop-dup-op'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-dup-op',
              occurredAt: '2026-02-14T12:03:01.000Z',
              itemId: 'item-second-page'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:03:01.000Z',
            changeId: 'desktop-dup-op'
          },
          lastReconciledWriteIds: {
            desktop: 2
          }
        };
      }
    };
    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      pullLimit: 1,
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });

    await expect(client.sync()).rejects.toThrow(
      /replayed opId desktop-dup-op during pull pagination/
    );
    expect(pullCount).toBe(2);
    expect(guardrailViolations).toContainEqual({
      code: 'pullDuplicateOpReplay',
      stage: 'pull',
      message:
        'pull response replayed an opId within one pull-until-settled cycle'
    });
    expect(client.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:03:00.000Z',
      changeId: 'desktop-dup-op'
    });
  });

  it('fails closed on duplicate pull replay after hydrate restart pagination', async () => {
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'remote-seed-restart-dup',
          opType: 'acl_add',
          itemId: 'item-seed-restart-dup',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:04:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      {
        pullLimit: 1
      }
    );
    await sourceClient.sync();
    const persistedState = sourceClient.exportState();
    const persistedCursor = sourceClient.snapshot().cursor;
    if (!persistedCursor) {
      throw new Error(
        'expected persisted cursor before restart duplication run'
      );
    }

    let pullCount = 0;
    const pullCursorSignatures: string[] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCursorSignatures.push(
          input.cursor
            ? `${input.cursor.changedAt}|${input.cursor.changeId}`
            : 'null'
        );
        pullCount += 1;

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-restart-dup',
                occurredAt: '2026-02-14T12:04:01.000Z',
                itemId: 'item-restart-first-page'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:01.000Z',
              changeId: 'desktop-restart-dup'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-restart-dup',
              occurredAt: '2026-02-14T12:04:02.000Z',
              itemId: 'item-restart-second-page'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:02.000Z',
            changeId: 'desktop-restart-dup'
          },
          lastReconciledWriteIds: {
            desktop: 2
          }
        };
      }
    };
    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    targetClient.hydrateState(persistedState);

    await expect(targetClient.sync()).rejects.toThrow(
      /replayed opId desktop-restart-dup during pull pagination/
    );
    expect(pullCount).toBe(2);
    expect(pullCursorSignatures).toEqual([
      `${persistedCursor.changedAt}|${persistedCursor.changeId}`,
      '2026-02-14T12:04:01.000Z|desktop-restart-dup'
    ]);
    expect(guardrailViolations).toEqual([
      {
        code: 'pullDuplicateOpReplay',
        stage: 'pull',
        message:
          'pull response replayed an opId within one pull-until-settled cycle'
      }
    ]);
    expect(targetClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:04:01.000Z',
      changeId: 'desktop-restart-dup'
    });
  });

  it('preserves reconcile baseline after duplicate replay failure and converges on corrected restart retry', async () => {
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'remote-seed-dup-recovery',
          opType: 'acl_add',
          itemId: 'item-seed-dup-recovery',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:04:30.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      {
        pullLimit: 1
      }
    );
    await sourceClient.sync();
    const persistedState = sourceClient.exportState();

    let failingPullCount = 0;
    let failingReconcileCalls = 0;
    const failingGuardrails: Array<{
      code: string;
      stage: string;
    }> = [];
    const failingTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        failingPullCount += 1;
        if (failingPullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-dup-recovery-1',
                occurredAt: '2026-02-14T12:04:31.000Z',
                itemId: 'item-dup-recovery-1'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:31.000Z',
              changeId: 'desktop-dup-recovery-1'
            },
            lastReconciledWriteIds: {
              desktop: 1,
              remote: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-dup-recovery-1',
              occurredAt: '2026-02-14T12:04:32.000Z',
              itemId: 'item-dup-recovery-2'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:32.000Z',
            changeId: 'desktop-dup-recovery-1'
          },
          lastReconciledWriteIds: {
            desktop: 2,
            remote: 1
          }
        };
      },
      reconcileState: async () => {
        failingReconcileCalls += 1;
        return {
          cursor: {
            changedAt: '2026-02-14T12:04:32.000Z',
            changeId: 'desktop-dup-recovery-1'
          },
          lastReconciledWriteIds: {
            desktop: 2,
            remote: 1
          }
        };
      }
    };
    const failingClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      failingTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          failingGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    failingClient.hydrateState(persistedState);

    await expect(failingClient.sync()).rejects.toThrow(
      /replayed opId desktop-dup-recovery-1 during pull pagination/
    );
    expect(failingPullCount).toBe(2);
    expect(failingReconcileCalls).toBe(0);
    expect(failingGuardrails).toEqual([
      {
        code: 'pullDuplicateOpReplay',
        stage: 'pull'
      }
    ]);

    const failedSnapshot = failingClient.snapshot();
    expect(failedSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:04:31.000Z',
      changeId: 'desktop-dup-recovery-1'
    });
    expect(failedSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 1,
      remote: 1
    });

    const resumedState = failingClient.exportState();
    let recoveredPullCount = 0;
    const recoveredPullCursors: string[] = [];
    const recoveredPulledOpIds: string[] = [];
    let recoveredReconcileCalls = 0;
    const recoveredTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        recoveredPullCursors.push(
          input.cursor
            ? `${input.cursor.changedAt}|${input.cursor.changeId}`
            : 'null'
        );
        recoveredPullCount += 1;

        if (recoveredPullCount === 1) {
          const pageItem = buildAclAddSyncItem({
            opId: 'desktop-dup-recovery-2',
            occurredAt: '2026-02-14T12:04:33.000Z',
            itemId: 'item-dup-recovery-3'
          });
          recoveredPulledOpIds.push(pageItem.opId);
          return {
            items: [pageItem],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:33.000Z',
              changeId: 'desktop-dup-recovery-2'
            },
            lastReconciledWriteIds: {
              desktop: 2,
              remote: 1
            }
          };
        }

        const pageItem = buildAclAddSyncItem({
          opId: 'desktop-dup-recovery-3',
          occurredAt: '2026-02-14T12:04:34.000Z',
          itemId: 'item-dup-recovery-4'
        });
        recoveredPulledOpIds.push(pageItem.opId);
        return {
          items: [pageItem],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:34.000Z',
            changeId: 'desktop-dup-recovery-3'
          },
          lastReconciledWriteIds: {
            desktop: 3,
            remote: 1
          }
        };
      },
      reconcileState: async (input) => {
        recoveredReconcileCalls += 1;
        return {
          cursor: input.cursor,
          lastReconciledWriteIds: {
            desktop: 3,
            remote: 1
          }
        };
      }
    };
    const recoveredGuardrails: Array<{
      code: string;
      stage: string;
    }> = [];
    const recoveredClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      recoveredTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          recoveredGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    recoveredClient.hydrateState(resumedState);

    const recoveryResult = await recoveredClient.sync();
    expect(recoveryResult).toEqual({
      pulledOperations: 2,
      pullPages: 2
    });
    expect(recoveredPullCount).toBe(2);
    expect(recoveredReconcileCalls).toBe(1);
    expect(recoveredPullCursors).toEqual([
      '2026-02-14T12:04:31.000Z|desktop-dup-recovery-1',
      '2026-02-14T12:04:33.000Z|desktop-dup-recovery-2'
    ]);
    expect(recoveredPulledOpIds).toEqual([
      'desktop-dup-recovery-2',
      'desktop-dup-recovery-3'
    ]);
    expect(recoveredGuardrails).toEqual([]);
    expect(recoveredClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:04:34.000Z',
      changeId: 'desktop-dup-recovery-3'
    });
    expect(recoveredClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      remote: 1
    });
  });

  it('keeps duplicate-replay fail->retry signatures deterministic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      failureCursorSignature: string;
      failureWriteIdSignature: string;
      failureGuardrailSignatures: string[];
      recoveredPullCursorSignatures: string[];
      recoveredPulledOpIds: string[];
      finalCursorSignature: string;
      finalWriteIdSignature: string;
    }> => {
      const random = createDeterministicRandom(seed);
      const desktopBaseWriteId = nextInt(random, 2, 5);
      const principalTypes = ['group', 'organization'] as const;
      const principalType = pickOne(principalTypes, random);
      const principalId = `${principalType}-seeded-dup-${seed}`;
      const baseMs = Date.parse('2026-02-14T12:05:00.000Z') + seed * 7_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      const seedServer = new InMemoryVfsCrdtSyncServer();
      await seedServer.pushOperations({
        operations: [
          {
            opId: `remote-seed-dup-signature-${seed}`,
            opType: 'acl_add',
            itemId: `item-seed-dup-signature-${seed}`,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType,
            principalId,
            accessLevel: 'read'
          }
        ]
      });
      const sourceClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        new InMemoryVfsCrdtSyncTransport(seedServer),
        {
          pullLimit: 1
        }
      );
      await sourceClient.sync();
      const persistedState = sourceClient.exportState();

      const duplicateOpId = `desktop-seeded-dup-op-${seed}`;
      let failingPullCount = 0;
      const failingGuardrails: Array<{
        code: string;
        stage: string;
      }> = [];
      const failingClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async () => {
            failingPullCount += 1;
            if (failingPullCount === 1) {
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: duplicateOpId,
                    occurredAt: at(1),
                    itemId: `item-seeded-dup-fail-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(1),
                  changeId: duplicateOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBaseWriteId,
                  remote: 1
                }
              };
            }

            return {
              items: [
                buildAclAddSyncItem({
                  opId: duplicateOpId,
                  occurredAt: at(2),
                  itemId: `item-seeded-dup-fail-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(2),
                changeId: duplicateOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBaseWriteId + 1,
                remote: 1
              }
            };
          }
        },
        {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            failingGuardrails.push({
              code: violation.code,
              stage: violation.stage
            });
          }
        }
      );
      failingClient.hydrateState(persistedState);

      await expect(failingClient.sync()).rejects.toThrow(
        new RegExp(`replayed opId ${duplicateOpId} during pull pagination`)
      );
      const failedSnapshot = failingClient.snapshot();
      if (!failedSnapshot.cursor) {
        throw new Error('expected failure cursor in seeded duplicate run');
      }

      const resumedState = failingClient.exportState();
      let recoveredPullCount = 0;
      const recoveredPullCursorSignatures: string[] = [];
      const recoveredPulledOpIds: string[] = [];
      const recoveredClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async (input) => {
            recoveredPullCount += 1;
            recoveredPullCursorSignatures.push(
              input.cursor
                ? `${input.cursor.changedAt}|${input.cursor.changeId}`
                : 'null'
            );

            if (recoveredPullCount === 1) {
              const firstRecoveryOpId = `desktop-seeded-recover-1-${seed}`;
              recoveredPulledOpIds.push(firstRecoveryOpId);
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: firstRecoveryOpId,
                    occurredAt: at(3),
                    itemId: `item-seeded-dup-recover-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(3),
                  changeId: firstRecoveryOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBaseWriteId + 1,
                  remote: 1
                }
              };
            }

            const secondRecoveryOpId = `desktop-seeded-recover-2-${seed}`;
            recoveredPulledOpIds.push(secondRecoveryOpId);
            return {
              items: [
                buildAclAddSyncItem({
                  opId: secondRecoveryOpId,
                  occurredAt: at(4),
                  itemId: `item-seeded-dup-recover-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(4),
                changeId: secondRecoveryOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBaseWriteId + 2,
                remote: 1
              }
            };
          },
          reconcileState: async (input) => ({
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: desktopBaseWriteId + 2,
              remote: 1
            }
          })
        },
        {
          pullLimit: 1
        }
      );
      recoveredClient.hydrateState(resumedState);
      await recoveredClient.sync();

      const finalSnapshot = recoveredClient.snapshot();
      if (!finalSnapshot.cursor) {
        throw new Error('expected final cursor in seeded duplicate run');
      }

      const failureCursorSignature = `${failedSnapshot.cursor.changedAt}|${failedSnapshot.cursor.changeId}`;
      const failureWriteIdSignature = JSON.stringify(
        failedSnapshot.lastReconciledWriteIds
      );
      const failureGuardrailSignatures = failingGuardrails.map(
        (violation) => `${violation.stage}:${violation.code}`
      );
      const finalCursorSignature = `${finalSnapshot.cursor.changedAt}|${finalSnapshot.cursor.changeId}`;
      const finalWriteIdSignature = JSON.stringify(
        finalSnapshot.lastReconciledWriteIds
      );

      expect(failureGuardrailSignatures).toEqual([
        'pull:pullDuplicateOpReplay'
      ]);
      expect(recoveredPullCursorSignatures).toEqual([
        failureCursorSignature,
        `${at(3)}|desktop-seeded-recover-1-${seed}`
      ]);
      expect(recoveredPulledOpIds).toEqual([
        `desktop-seeded-recover-1-${seed}`,
        `desktop-seeded-recover-2-${seed}`
      ]);
      expect(finalCursorSignature).toBe(
        `${at(4)}|desktop-seeded-recover-2-${seed}`
      );
      expect(finalWriteIdSignature).toBe(
        JSON.stringify({
          desktop: desktopBaseWriteId + 2,
          remote: 1
        })
      );

      return {
        failureCursorSignature,
        failureWriteIdSignature,
        failureGuardrailSignatures,
        recoveredPullCursorSignatures,
        recoveredPulledOpIds,
        finalCursorSignature,
        finalWriteIdSignature
      };
    };

    const seeds = [1771, 1772, 1773] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
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

  it('fails closed when hydrated reconcile cursor trails replay cursor and keeps state pristine', () => {
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
      changedAt: '2026-02-14T14:12:01.000Z',
      changeId: 'desktop-2'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:12:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /persisted reconcile cursor regressed persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'persisted reconcile cursor regressed persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('hydrates when replay, reconcile, and container clock cursors share an equal boundary', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate-equal',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:12:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error('expected replay cursor for equal-boundary hydrate test');
    }
    const boundaryClock = persisted.containerClocks.find(
      (entry) => entry.containerId === 'item-hydrate-equal'
    );
    if (!boundaryClock) {
      throw new Error(
        'expected container clock for equal-boundary hydrate test'
      );
    }
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: boundaryClock.changedAt,
          changeId: boundaryClock.changeId
        },
        replayCursor
      )
    ).toBe(0);

    persisted.reconcileState = {
      cursor: {
        changedAt: replayCursor.changedAt,
        changeId: replayCursor.changeId
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(guardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().cursor).toEqual(replayCursor);
  });

  it('fails closed when hydrated container clock is ahead of persisted sync cursor and keeps state pristine', () => {
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
      changedAt: '2026-02-14T14:13:00.000Z',
      changeId: 'desktop-1'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:13:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };
    persisted.containerClocks = [
      {
        containerId: 'item-ahead',
        changedAt: '2026-02-14T14:13:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks\[0\] is ahead of persisted sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks[0] is ahead of persisted sync cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks contain duplicate container ids and keeps state pristine', () => {
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
    persisted.containerClocks = [
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:00.000Z',
        changeId: 'desktop-1'
      },
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks has duplicate containerId item-dup/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks has duplicate containerId item-dup'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks are present without a persisted cursor and keeps state pristine', () => {
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
    persisted.containerClocks = [
      {
        containerId: 'item-orphan-clock',
        changedAt: '2026-02-14T14:15:00.000Z',
        changeId: 'desktop-1'
      }
    ];
    persisted.replaySnapshot.cursor = null;
    persisted.reconcileState = null;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks requires persisted replay or reconcile cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.containerClocks requires persisted replay or reconcile cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('rebases hydrated nextLocalWriteId above pending and reconcile write-id floors', () => {
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
        opId: 'desktop-7',
        opType: 'acl_add',
        itemId: 'item-write-floor',
        replicaId: 'desktop',
        writeId: 7,
        occurredAt: '2026-02-14T14:16:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'desktop-8',
        opType: 'acl_add',
        itemId: 'item-write-floor',
        replicaId: 'desktop',
        writeId: 8,
        occurredAt: '2026-02-14T14:16:01.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }
    ];
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:16:02.000Z',
        changeId: 'desktop-9'
      },
      lastReconciledWriteIds: {
        desktop: 20
      }
    };
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).not.toThrow();
    expect(guardrailViolations).toEqual([]);
    expect(client.snapshot().pendingOperations).toBe(2);
    expect(client.snapshot().nextLocalWriteId).toBe(21);
  });

  it('normalizes hydrated pending occurredAt ordering above cursor on flush', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-pending-floor',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:17:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error('expected replay cursor for pending occurredAt test');
    }

    persisted.pendingOperations = [
      {
        opId: 'desktop-2',
        opType: 'acl_add',
        itemId: 'item-pending-floor',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T14:16:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-3',
        opType: 'acl_add',
        itemId: 'item-pending-floor',
        replicaId: 'desktop',
        writeId: 3,
        occurredAt: '2026-02-14T14:15:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'admin'
      }
    ];
    persisted.nextLocalWriteId = 4;

    const pushedOperations: Array<{
      opId: string;
      writeId: number;
      occurredAt: string;
    }> = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedOperations.push({
            opId: operation.opId,
            writeId: operation.writeId,
            occurredAt: operation.occurredAt
          });
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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
    resumedClient.hydrateState(persisted);

    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedOperations.map((operation) => operation.opId)).toEqual([
      'desktop-2',
      'desktop-3'
    ]);
    expect(pushedOperations.map((operation) => operation.writeId)).toEqual([
      2, 3
    ]);

    const cursorMs = Date.parse(replayCursor.changedAt);
    const firstOccurredAtMs = Date.parse(pushedOperations[0]?.occurredAt ?? '');
    const secondOccurredAtMs = Date.parse(
      pushedOperations[1]?.occurredAt ?? ''
    );
    expect(firstOccurredAtMs).toBeGreaterThan(cursorMs);
    expect(secondOccurredAtMs).toBeGreaterThan(firstOccurredAtMs);
  });

  it('fails closed when hydrated pending opId collides with persisted cursor boundary and keeps state pristine', () => {
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
      changedAt: '2026-02-14T14:18:00.000Z',
      changeId: 'desktop-2'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:18:01.000Z',
        changeId: 'desktop-3'
      },
      lastReconciledWriteIds: {
        desktop: 3
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-3',
        opType: 'acl_add',
        itemId: 'item-collision',
        replicaId: 'desktop',
        writeId: 4,
        occurredAt: '2026-02-14T14:18:02.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ];
    persisted.nextLocalWriteId = 5;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.pendingOperations contains opId desktop-3 that collides with persisted cursor boundary/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations contains opId desktop-3 that collides with persisted cursor boundary'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('hydrates and flushes unique-above-boundary pending ops with monotonic write-id and occurredAt normalization', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-above-boundary',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:19:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:19:00.000Z',
        changeId: 'remote-1'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-6',
        opType: 'acl_add',
        itemId: 'item-above-boundary',
        replicaId: 'desktop',
        writeId: 6,
        occurredAt: '2026-02-14T14:18:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-7',
        opType: 'acl_add',
        itemId: 'item-above-boundary',
        replicaId: 'desktop',
        writeId: 7,
        occurredAt: '2026-02-14T14:18:58.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'admin'
      }
    ];
    persisted.nextLocalWriteId = 1;

    const pushedOperations: Array<{
      opId: string;
      writeId: number;
      occurredAt: string;
    }> = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedOperations.push({
            opId: operation.opId,
            writeId: operation.writeId,
            occurredAt: operation.occurredAt
          });
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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
    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(8);

    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedOperations.map((operation) => operation.opId)).toEqual([
      'desktop-6',
      'desktop-7'
    ]);
    expect(pushedOperations.map((operation) => operation.writeId)).toEqual([
      6, 7
    ]);

    const cursorMs = Date.parse('2026-02-14T14:19:00.000Z');
    const firstOccurredAtMs = Date.parse(pushedOperations[0]?.occurredAt ?? '');
    const secondOccurredAtMs = Date.parse(
      pushedOperations[1]?.occurredAt ?? ''
    );
    expect(firstOccurredAtMs).toBeGreaterThan(cursorMs);
    expect(secondOccurredAtMs).toBeGreaterThan(firstOccurredAtMs);
    expect(resumedClient.snapshot().pendingOperations).toBe(0);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(8);
  });

  it('deterministically rebases equal-timestamp hydrated pending ops with descending opIds during flush', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-deterministic-rebase',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:20:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:20:00.000Z',
        changeId: 'remote-1'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-c',
        opType: 'acl_add',
        itemId: 'item-deterministic-rebase',
        replicaId: 'desktop',
        writeId: 6,
        occurredAt: '2026-02-14T14:19:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-b',
        opType: 'acl_add',
        itemId: 'item-deterministic-rebase',
        replicaId: 'desktop',
        writeId: 7,
        occurredAt: '2026-02-14T14:19:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'admin'
      },
      {
        opId: 'desktop-a',
        opType: 'acl_add',
        itemId: 'item-deterministic-rebase',
        replicaId: 'desktop',
        writeId: 8,
        occurredAt: '2026-02-14T14:19:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ];
    persisted.nextLocalWriteId = 1;

    const pushedOperations: Array<{
      opId: string;
      writeId: number;
      occurredAt: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedOperations.push({
            opId: operation.opId,
            writeId: operation.writeId,
            occurredAt: operation.occurredAt
          });
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport
    );
    resumedClient.hydrateState(persisted);

    await resumedClient.flush();

    expect(pushedOperations.map((operation) => operation.opId)).toEqual([
      'desktop-c',
      'desktop-b',
      'desktop-a'
    ]);
    expect(pushedOperations.map((operation) => operation.writeId)).toEqual([
      6, 7, 8
    ]);

    const cursorMs = Date.parse('2026-02-14T14:20:00.000Z');
    const firstOccurredAtMs = Date.parse(pushedOperations[0]?.occurredAt ?? '');
    const secondOccurredAtMs = Date.parse(
      pushedOperations[1]?.occurredAt ?? ''
    );
    const thirdOccurredAtMs = Date.parse(pushedOperations[2]?.occurredAt ?? '');
    expect(firstOccurredAtMs).toBe(cursorMs + 1);
    expect(secondOccurredAtMs).toBe(firstOccurredAtMs + 1);
    expect(thirdOccurredAtMs).toBe(secondOccurredAtMs + 1);
  });

  it('hydrates and flushes pending ops with non-conventional opIds when replica and writeId invariants hold', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    const persisted = sourceClient.exportState();
    persisted.pendingOperations = [
      {
        opId: 'custom/op@6',
        opType: 'acl_add',
        itemId: 'item-custom-opid',
        replicaId: 'desktop',
        writeId: 6,
        occurredAt: '2026-02-14T14:21:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'custom:op#7',
        opType: 'acl_add',
        itemId: 'item-custom-opid',
        replicaId: 'desktop',
        writeId: 7,
        occurredAt: '2026-02-14T14:21:01.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }
    ];
    persisted.nextLocalWriteId = 1;

    const pushedOpIds: string[] = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOpIds.push(
          ...input.operations.map((operation) => operation.opId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().pendingOperations).toBe(2);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(8);

    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedOpIds).toEqual(['custom/op@6', 'custom:op#7']);
    expect(resumedClient.snapshot().pendingOperations).toBe(0);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(8);
  });

  it('fails closed on earliest malformed mixed pending op while writeIds remain monotonic', () => {
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
    persisted.pendingOperations = [
      {
        opId: 'desktop-1',
        opType: 'link_add',
        itemId: 'item-mixed-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T14:22:00.000Z',
        parentId: 'root',
        childId: 'item-mixed-1'
      },
      {
        opId: 'desktop-2',
        opType: 'acl_add',
        itemId: 'item-mixed-2',
        replicaId: 'desktop',
        writeId: 2,
        occurredAt: '2026-02-14T14:22:01.000Z',
        principalType: 'group',
        principalId: 'group-1',
        parentId: 'root',
        childId: 'item-mixed-2'
      },
      {
        opId: 'desktop-3',
        opType: 'acl_remove',
        itemId: 'item-mixed-3',
        replicaId: 'desktop',
        writeId: 3,
        occurredAt: '2026-02-14T14:22:02.000Z',
        principalType: 'group',
        principalId: 'group-1'
      }
    ];
    persisted.nextLocalWriteId = 4;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.pendingOperations\[1\] is missing acl accessLevel/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.pendingOperations[1] is missing acl accessLevel'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('hydrates and flushes mixed acl+link pending ops when invariants hold', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    const persisted = sourceClient.exportState();
    persisted.pendingOperations = [
      {
        opId: 'desktop-11',
        opType: 'acl_add',
        itemId: 'item-mixed-valid',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:23:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'desktop-12',
        opType: 'link_add',
        itemId: 'item-mixed-link',
        replicaId: 'desktop',
        writeId: 12,
        occurredAt: '2026-02-14T14:23:01.000Z',
        parentId: 'root',
        childId: 'item-mixed-link'
      },
      {
        opId: 'desktop-13',
        opType: 'acl_remove',
        itemId: 'item-mixed-valid',
        replicaId: 'desktop',
        writeId: 13,
        occurredAt: '2026-02-14T14:23:02.000Z',
        principalType: 'group',
        principalId: 'group-1'
      }
    ];
    persisted.nextLocalWriteId = 1;

    const pushedSummary: Array<{
      opId: string;
      opType: string;
      writeId: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedSummary.push({
            opId: operation.opId,
            opType: operation.opType,
            writeId: operation.writeId
          });
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().pendingOperations).toBe(3);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(14);

    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedSummary).toEqual([
      {
        opId: 'desktop-11',
        opType: 'acl_add',
        writeId: 11
      },
      {
        opId: 'desktop-12',
        opType: 'link_add',
        writeId: 12
      },
      {
        opId: 'desktop-13',
        opType: 'acl_remove',
        writeId: 13
      }
    ]);
    expect(resumedClient.snapshot().pendingOperations).toBe(0);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(14);
    expect(resumedClient.snapshot().acl).toEqual([]);
    expect(resumedClient.snapshot().links).toEqual([
      {
        parentId: 'root',
        childId: 'item-mixed-link'
      }
    ]);
  });

  it('hydrates with reconcile cursor ahead of replay cursor and flushes mixed pending ops without false guardrails', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-ahead',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:24:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:24:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 20
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-21',
        opType: 'acl_add',
        itemId: 'item-reconcile-ahead',
        replicaId: 'desktop',
        writeId: 21,
        occurredAt: '2026-02-14T14:24:01.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-22',
        opType: 'link_add',
        itemId: 'item-reconcile-ahead',
        replicaId: 'desktop',
        writeId: 22,
        occurredAt: '2026-02-14T14:24:00.000Z',
        parentId: 'root',
        childId: 'item-reconcile-ahead'
      }
    ];
    persisted.nextLocalWriteId = 1;

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pushedOperations: Array<{
      writeId: number;
      occurredAt: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        for (const operation of input.operations) {
          pushedOperations.push({
            writeId: operation.writeId,
            occurredAt: operation.occurredAt
          });
        }
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T14:24:02.000Z',
      changeId: 'remote-2'
    });
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(23);

    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedOperations.map((operation) => operation.writeId)).toEqual([
      21, 22
    ]);
    const cursorMs = Date.parse('2026-02-14T14:24:02.000Z');
    const firstOccurredAtMs = Date.parse(pushedOperations[0]?.occurredAt ?? '');
    const secondOccurredAtMs = Date.parse(
      pushedOperations[1]?.occurredAt ?? ''
    );
    expect(firstOccurredAtMs).toBeGreaterThan(cursorMs);
    expect(secondOccurredAtMs).toBeGreaterThan(firstOccurredAtMs);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(23);
    expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(22);
  });

  it('hydrates when reconcile write-id lags pending queue without rolling back local write-id progression', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-writeid-lag',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:25:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:25:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-writeid-lag',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:24:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-writeid-lag',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:24:58.000Z',
        parentId: 'root',
        childId: 'item-writeid-lag'
      }
    ];
    persisted.nextLocalWriteId = 2;

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pushedWriteIds: number[] = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(12);
    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedWriteIds).toEqual([10, 11]);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(12);
    expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(11);
  });

  it('preserves cursor and write-id monotonicity across two hydrate+flush cycles with reconcile-ahead lineage', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-two-cycle',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:26:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const cycleOnePersisted = sourceClient.exportState();
    cycleOnePersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:26:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:25:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:25:58.000Z',
        parentId: 'root',
        childId: 'item-two-cycle'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const cycleOnePushWriteIds: number[] = [];
    const cycleOneTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        cycleOnePushWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      cycleOneTransport,
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
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();
    expect(cycleOnePushWriteIds).toEqual([10, 11]);
    expect(cycleOneClient.snapshot().nextLocalWriteId).toBe(12);
    const cycleOneCursor = cycleOneClient.snapshot().cursor;
    if (!cycleOneCursor) {
      throw new Error('expected cycle one cursor');
    }

    const cycleTwoPersisted = cycleOneClient.exportState();
    cycleTwoPersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:26:06.000Z',
        changeId: 'remote-3'
      },
      lastReconciledWriteIds: {
        desktop: 15
      }
    };
    cycleTwoPersisted.pendingOperations = [
      {
        opId: 'desktop-16',
        opType: 'acl_remove',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:26:01.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:26:00.000Z',
        parentId: 'root',
        childId: 'item-two-cycle'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 3;

    const cycleTwoPushWriteIds: number[] = [];
    const cycleTwoTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        cycleTwoPushWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      cycleTwoTransport,
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
    cycleTwoClient.hydrateState(cycleTwoPersisted);
    await cycleTwoClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(cycleTwoPushWriteIds).toEqual([16, 17]);
    expect(cycleTwoClient.snapshot().nextLocalWriteId).toBe(18);
    const cycleTwoCursor = cycleTwoClient.snapshot().cursor;
    if (!cycleTwoCursor) {
      throw new Error('expected cycle two cursor');
    }

    expect(
      compareVfsSyncCursorOrder(cycleTwoCursor, cycleOneCursor)
    ).toBeGreaterThan(0);
    expect(cycleTwoClient.snapshot().lastReconciledWriteIds.desktop).toBe(17);
  });

  it('keeps cursor and write-id monotonicity across three deterministic restart cycles with alternating reconcile lineage', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-three-cycle-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:27:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await seedClient.sync();

    const random = createDeterministicRandom(1222);
    const parentIds = ['root', 'archive'] as const;
    const aclPrincipalTypes = ['group', 'organization'] as const;
    const aclAccessLevels = ['read', 'write', 'admin'] as const;
    const cycleWriteIdStarts = [10, 16, 23] as const;
    const reconcileModes = ['ahead', 'equal', 'ahead'] as const;
    const cyclePushWriteIds: number[][] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    let activeClient = seedClient;
    let previousCursor = seedClient.snapshot().cursor;

    for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
      const persisted = activeClient.exportState();
      const replayCursor = persisted.replaySnapshot.cursor;
      if (!replayCursor) {
        throw new Error(`expected replay cursor before cycle ${index + 1}`);
      }

      const reconcileMode = reconcileModes[index];
      if (reconcileMode === 'ahead') {
        const replayCursorMs = Date.parse(replayCursor.changedAt);
        const aheadCursorMs = Number.isFinite(replayCursorMs)
          ? replayCursorMs + 2_000
          : Date.parse('2026-02-14T14:27:10.000Z') + index;
        persisted.reconcileState = {
          cursor: {
            changedAt: new Date(aheadCursorMs).toISOString(),
            changeId: `remote-cycle-${index + 2}`
          },
          lastReconciledWriteIds: {
            desktop: Math.max(0, cycleStartWriteId - 3)
          }
        };
      } else {
        persisted.reconcileState = {
          cursor: replayCursor,
          lastReconciledWriteIds: {
            desktop: Math.max(0, cycleStartWriteId - 3)
          }
        };
      }

      const opVariant = nextInt(random, 0, 1);
      const itemId = `item-three-cycle-${index + 1}`;
      const firstOccurredAt = new Date(
        Date.parse('2026-02-14T14:26:40.000Z') - index * 1_000
      ).toISOString();
      const secondOccurredAt = new Date(
        Date.parse('2026-02-14T14:26:39.000Z') - index * 1_000
      ).toISOString();
      const aclPrincipalType = pickOne(aclPrincipalTypes, random);
      const aclPrincipalId = `${aclPrincipalType}-${index + 1}`;
      const aclAccessLevel = pickOne(aclAccessLevels, random);
      const parentId = pickOne(parentIds, random);

      persisted.pendingOperations =
        opVariant === 0
          ? [
              {
                opId: `desktop-${cycleStartWriteId}`,
                opType: 'acl_add',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId,
                occurredAt: firstOccurredAt,
                principalType: aclPrincipalType,
                principalId: aclPrincipalId,
                accessLevel: aclAccessLevel
              },
              {
                opId: `desktop-${cycleStartWriteId + 1}`,
                opType: 'link_add',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId + 1,
                occurredAt: secondOccurredAt,
                parentId,
                childId: itemId
              }
            ]
          : [
              {
                opId: `desktop-${cycleStartWriteId}`,
                opType: 'link_remove',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId,
                occurredAt: firstOccurredAt,
                parentId,
                childId: itemId
              },
              {
                opId: `desktop-${cycleStartWriteId + 1}`,
                opType: 'acl_remove',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId + 1,
                occurredAt: secondOccurredAt,
                principalType: aclPrincipalType,
                principalId: aclPrincipalId
              }
            ];
      persisted.nextLocalWriteId = 1;

      const pushedWriteIds: number[] = [];
      const pushedOccurredAtMs: number[] = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          for (const operation of input.operations) {
            pushedWriteIds.push(operation.writeId);
            pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
          }
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
      const resumedClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
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

      resumedClient.hydrateState(persisted);
      await resumedClient.flush();
      cyclePushWriteIds.push(pushedWriteIds);

      expect(pushedWriteIds).toEqual([
        cycleStartWriteId,
        cycleStartWriteId + 1
      ]);
      expect(resumedClient.snapshot().nextLocalWriteId).toBe(
        cycleStartWriteId + 2
      );

      const persistedCursor = persisted.reconcileState?.cursor ?? replayCursor;
      const persistedCursorMs = Date.parse(persistedCursor.changedAt);
      const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
      const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
      if (
        firstPushedOccurredAtMs === undefined ||
        secondPushedOccurredAtMs === undefined
      ) {
        throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
      }
      expect(firstPushedOccurredAtMs).toBeGreaterThan(persistedCursorMs);
      expect(secondPushedOccurredAtMs).toBeGreaterThan(firstPushedOccurredAtMs);

      const cycleCursor = resumedClient.snapshot().cursor;
      if (!cycleCursor) {
        throw new Error(`expected cycle cursor for cycle ${index + 1}`);
      }
      if (previousCursor) {
        expect(
          compareVfsSyncCursorOrder(cycleCursor, previousCursor)
        ).toBeGreaterThan(0);
      }

      expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(
        cycleStartWriteId + 1
      );

      previousCursor = cycleCursor;
      activeClient = resumedClient;
    }

    expect(cyclePushWriteIds).toEqual([
      [10, 11],
      [16, 17],
      [23, 24]
    ]);
    expect(guardrailViolations).toEqual([]);
  });

  it('normalizes repeated reconcile write-id lag under replay-aligned restart cycles without guardrail noise', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-lag-cycle-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:29:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await seedClient.sync();

    const random = createDeterministicRandom(1223);
    const parentIds = ['root', 'archive'] as const;
    const principalTypes = ['group', 'organization'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    const cycleWriteIdStarts = [12, 20, 29] as const;
    const cyclePushWriteIds: number[][] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    let activeClient = seedClient;
    let previousCycleCursor = seedClient.snapshot().cursor;

    for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
      const persisted = activeClient.exportState();
      const replayCursor = persisted.replaySnapshot.cursor;
      if (!replayCursor) {
        throw new Error(`expected replay cursor before cycle ${index + 1}`);
      }

      persisted.reconcileState = {
        cursor: replayCursor,
        lastReconciledWriteIds: {
          desktop: Math.max(0, cycleStartWriteId - 7)
        }
      };

      const itemId = `item-lag-cycle-${index + 1}`;
      const principalType = pickOne(principalTypes, random);
      const principalId = `${principalType}-lag-${index + 1}`;
      const accessLevel = pickOne(accessLevels, random);
      const parentId = pickOne(parentIds, random);
      const firstOccurredAt = new Date(
        Date.parse('2026-02-14T14:28:40.000Z') - index * 1_000
      ).toISOString();
      const secondOccurredAt = new Date(
        Date.parse('2026-02-14T14:28:39.000Z') - index * 1_000
      ).toISOString();
      persisted.pendingOperations = [
        {
          opId: `desktop-${cycleStartWriteId}`,
          opType: 'acl_add',
          itemId,
          replicaId: 'desktop',
          writeId: cycleStartWriteId,
          occurredAt: firstOccurredAt,
          principalType,
          principalId,
          accessLevel
        },
        {
          opId: `desktop-${cycleStartWriteId + 1}`,
          opType: 'link_add',
          itemId,
          replicaId: 'desktop',
          writeId: cycleStartWriteId + 1,
          occurredAt: secondOccurredAt,
          parentId,
          childId: itemId
        }
      ];
      persisted.nextLocalWriteId = 1;

      const pushedWriteIds: number[] = [];
      const pushedOccurredAtMs: number[] = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          for (const operation of input.operations) {
            pushedWriteIds.push(operation.writeId);
            pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
          }
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
      const resumedClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
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

      expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
      await resumedClient.flush();
      cyclePushWriteIds.push(pushedWriteIds);

      expect(pushedWriteIds).toEqual([
        cycleStartWriteId,
        cycleStartWriteId + 1
      ]);
      expect(resumedClient.snapshot().nextLocalWriteId).toBe(
        cycleStartWriteId + 2
      );
      expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(
        cycleStartWriteId + 1
      );

      const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
      const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
      if (
        firstPushedOccurredAtMs === undefined ||
        secondPushedOccurredAtMs === undefined
      ) {
        throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
      }

      const replayCursorMs = Date.parse(replayCursor.changedAt);
      expect(firstPushedOccurredAtMs).toBeGreaterThan(replayCursorMs);
      expect(secondPushedOccurredAtMs).toBeGreaterThan(firstPushedOccurredAtMs);

      const resumedState = resumedClient.exportState();
      expect(resumedState.replaySnapshot.cursor).not.toBeNull();
      expect(resumedState.reconcileState?.cursor).toEqual(
        resumedState.replaySnapshot.cursor
      );

      const cycleCursor = resumedClient.snapshot().cursor;
      if (!cycleCursor) {
        throw new Error(`expected cycle cursor for cycle ${index + 1}`);
      }
      if (previousCycleCursor) {
        expect(
          compareVfsSyncCursorOrder(cycleCursor, previousCycleCursor)
        ).toBeGreaterThan(0);
      }

      previousCycleCursor = cycleCursor;
      activeClient = resumedClient;
    }

    expect(cyclePushWriteIds).toEqual([
      [12, 13],
      [20, 21],
      [29, 30]
    ]);
    expect(guardrailViolations).toEqual([]);
  });

  it('fails closed on boundary opId collision during later replay-aligned restart cycle and keeps state pristine', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-boundary-collision',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:30:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const cycleOnePersisted = sourceClient.exportState();
    const cycleOneReplayCursor = cycleOnePersisted.replaySnapshot.cursor;
    if (!cycleOneReplayCursor) {
      throw new Error('expected cycle-one replay cursor');
    }
    cycleOnePersisted.reconcileState = {
      cursor: cycleOneReplayCursor,
      lastReconciledWriteIds: {
        desktop: 6
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:29:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:29:58.000Z',
        parentId: 'root',
        childId: 'item-boundary-collision'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();

    const preCollisionServerSnapshot = server.snapshot();
    const cycleTwoPersisted = cycleOneClient.exportState();
    const cycleTwoReplayCursor = cycleTwoPersisted.replaySnapshot.cursor;
    if (!cycleTwoReplayCursor) {
      throw new Error('expected cycle-two replay cursor');
    }
    cycleTwoPersisted.reconcileState = {
      cursor: cycleTwoReplayCursor,
      lastReconciledWriteIds: {
        desktop: 9
      }
    };

    const collidingOpId = cycleTwoReplayCursor.changeId;
    cycleTwoPersisted.pendingOperations = [
      {
        opId: collidingOpId,
        opType: 'acl_remove',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:29:57.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:29:56.000Z',
        parentId: 'root',
        childId: 'item-boundary-collision'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 1;

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const trackingTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      trackingTransport,
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
    const pristineState = cycleTwoClient.exportState();
    const expectedMessage = `state.pendingOperations contains opId ${collidingOpId} that collides with persisted cursor boundary`;

    expect(() => cycleTwoClient.hydrateState(cycleTwoPersisted)).toThrow(
      expectedMessage
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message: expectedMessage
      }
    ]);
    expect(cycleTwoClient.exportState()).toEqual(pristineState);
    expect(pushedOperationCount).toBe(0);
    expect(server.snapshot()).toEqual(preCollisionServerSnapshot);
  });

  it('fails closed on regressing reconcile lineage after a prior restart cycle and preserves pristine state', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-regressed-cycle',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:28:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const cycleOnePersisted = sourceClient.exportState();
    cycleOnePersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:28:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 6
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:27:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:27:58.000Z',
        parentId: 'root',
        childId: 'item-regressed-cycle'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();

    const preRegressionServerSnapshot = server.snapshot();
    const cycleTwoPersisted = cycleOneClient.exportState();
    const cycleTwoReplayCursor = cycleTwoPersisted.replaySnapshot.cursor;
    if (!cycleTwoReplayCursor) {
      throw new Error('expected replay cursor before regression cycle');
    }
    cycleTwoPersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:27:55.000Z',
        changeId: 'remote-regressed'
      },
      lastReconciledWriteIds: {
        desktop: 8
      }
    };
    cycleTwoPersisted.pendingOperations = [
      {
        opId: 'desktop-16',
        opType: 'acl_remove',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:27:57.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:27:56.000Z',
        parentId: 'root',
        childId: 'item-regressed-cycle'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 1;

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const trackingTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      trackingTransport,
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
    const pristineState = cycleTwoClient.exportState();

    expect(() => cycleTwoClient.hydrateState(cycleTwoPersisted)).toThrow(
      'persisted reconcile cursor regressed persisted replay cursor'
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message: 'persisted reconcile cursor regressed persisted replay cursor'
      }
    ]);
    expect(cycleTwoClient.exportState()).toEqual(pristineState);
    expect(pushedOperationCount).toBe(0);
    expect(server.snapshot()).toEqual(preRegressionServerSnapshot);

    expect(
      compareVfsSyncCursorOrder(
        cycleTwoReplayCursor,
        cycleTwoPersisted.reconcileState.cursor
      )
    ).toBeGreaterThan(0);
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

  it('avoids boundary replay across restart paginated pulls while write-id baselines stay monotonic', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-boundary-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:35:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-boundary-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T14:35:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const observedPulls: Array<{
      phase: 'seed' | 'resumed';
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
      lastReconciledWriteIds: Record<string, number>;
    }> = [];
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const makeObservedTransport = (
      phase: 'seed' | 'resumed'
    ): VfsCrdtSyncTransport => ({
      pushOperations: (input) => baseTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseTransport.pullOperations(input);
        observedPulls.push({
          phase,
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null,
          lastReconciledWriteIds: { ...response.lastReconciledWriteIds }
        });
        return response;
      },
      reconcileState: baseTransport.reconcileState
        ? (input) => baseTransport.reconcileState(input)
        : undefined
    });

    const seedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          seedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedGuardrailViolations).toEqual([]);
    expect(seedClient.snapshot().lastReconciledWriteIds.remote).toBe(2);

    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = persistedSeedState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected replay seed cursor before restart');
    }

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-boundary-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T14:35:02.000Z',
          parentId: 'root',
          childId: 'item-boundary-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-boundary-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T14:35:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          resumedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    resumedClient.hydrateState(persistedSeedState);
    await resumedClient.sync();

    const resumedPulls = observedPulls.filter(
      (pull) => pull.phase === 'resumed'
    );
    expect(resumedPulls.length).toBe(2);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[0]?.items.map((item) => item.opId)).toEqual([
      'remote-3'
    ]);
    expect(resumedPulls[0]?.lastReconciledWriteIds.remote).toBe(4);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T14:35:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[1]?.items.map((item) => item.opId)).toEqual([
      'remote-4'
    ]);
    expect(resumedPulls[1]?.hasMore).toBe(false);

    const resumedPulledOpIds = resumedPulls.flatMap((pull) =>
      pull.items.map((item) => item.opId)
    );
    expect(resumedPulledOpIds).not.toContain(seedReplayCursor.changeId);
    for (const pull of resumedPulls) {
      for (const item of pull.items) {
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
    }

    expect(resumedGuardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().lastReconciledWriteIds.remote).toBe(4);
    const resumedCursor = resumedClient.snapshot().cursor;
    if (!resumedCursor) {
      throw new Error('expected resumed cursor');
    }
    expect(
      compareVfsSyncCursorOrder(resumedCursor, seedReplayCursor)
    ).toBeGreaterThan(0);
  });

  it('merges reconcile transport clocks monotonically across restart paginated pull cycles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:36:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T14:36:01.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const observedPulls: Array<{
      phase: 'seed' | 'resumed';
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
      lastReconciledWriteIds: Record<string, number>;
    }> = [];
    const observedReconcileInputs: Array<{
      phase: 'seed' | 'resumed';
      cursor: { changedAt: string; changeId: string };
      lastReconciledWriteIds: Record<string, number>;
    }> = [];
    const observedReconcileResponses: Array<{
      phase: 'seed' | 'resumed';
      cursor: { changedAt: string; changeId: string };
      lastReconciledWriteIds: Record<string, number>;
    }> = [];
    let reconcileCallCount = 0;
    const makeObservedTransport = (
      phase: 'seed' | 'resumed'
    ): VfsCrdtSyncTransport => ({
      pushOperations: (input) => baseTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseTransport.pullOperations(input);
        observedPulls.push({
          phase,
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null,
          lastReconciledWriteIds: { ...response.lastReconciledWriteIds }
        });
        return response;
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        observedReconcileInputs.push({
          phase,
          cursor: { ...input.cursor },
          lastReconciledWriteIds: { ...input.lastReconciledWriteIds }
        });

        const reconciledWriteIds =
          reconcileCallCount === 1
            ? {
                ...input.lastReconciledWriteIds,
                desktop: 3,
                mobile: 5
              }
            : {
                ...input.lastReconciledWriteIds,
                desktop: 7,
                mobile: 9
              };
        const response = {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: reconciledWriteIds
        };
        observedReconcileResponses.push({
          phase,
          cursor: { ...response.cursor },
          lastReconciledWriteIds: { ...response.lastReconciledWriteIds }
        });
        return response;
      }
    });

    const seedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          seedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedGuardrailViolations).toEqual([]);
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 2
    });
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = persistedSeedState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected replay cursor before reconcile restart cycle');
    }

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T14:36:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T14:36:03.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          resumedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    resumedClient.hydrateState(persistedSeedState);
    await resumedClient.sync();

    const resumedPulls = observedPulls.filter(
      (pull) => pull.phase === 'resumed'
    );
    expect(resumedPulls.length).toBe(2);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[0]?.items.map((item) => item.opId)).toEqual([
      'remote-3'
    ]);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T14:36:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[1]?.items.map((item) => item.opId)).toEqual([
      'remote-4'
    ]);
    expect(
      resumedPulls.flatMap((pull) => pull.items.map((item) => item.opId))
    ).not.toContain(seedReplayCursor.changeId);

    expect(observedReconcileInputs).toEqual([
      {
        phase: 'seed',
        cursor: {
          changedAt: '2026-02-14T14:36:01.000Z',
          changeId: 'remote-2'
        },
        lastReconciledWriteIds: {
          remote: 2
        }
      },
      {
        phase: 'resumed',
        cursor: {
          changedAt: '2026-02-14T14:36:03.000Z',
          changeId: 'remote-4'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 5,
          remote: 4
        }
      }
    ]);
    expect(observedReconcileResponses).toEqual([
      {
        phase: 'seed',
        cursor: {
          changedAt: '2026-02-14T14:36:01.000Z',
          changeId: 'remote-2'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 5,
          remote: 2
        }
      },
      {
        phase: 'resumed',
        cursor: {
          changedAt: '2026-02-14T14:36:03.000Z',
          changeId: 'remote-4'
        },
        lastReconciledWriteIds: {
          desktop: 7,
          mobile: 9,
          remote: 4
        }
      }
    ]);
    expect(resumedGuardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 7,
      mobile: 9,
      remote: 4
    });
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

  it('fails closed when post-restart pull cycle regresses write ids below local reconcile baseline', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCount += 1;
        pullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:15:00.000Z',
                itemId: 'item-baseline-a'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:15:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-2',
                occurredAt: '2026-02-14T12:15:01.000Z',
                itemId: 'item-baseline-b'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:15:01.000Z',
              changeId: 'desktop-2'
            },
            lastReconciledWriteIds: {
              desktop: 6
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-3',
              occurredAt: '2026-02-14T12:15:02.000Z',
              itemId: 'item-should-not-apply'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:15:02.000Z',
            changeId: 'desktop-3'
          },
          lastReconciledWriteIds: {
            desktop: 5
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds.desktop).toBe(6);

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state'
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply'
      })
    );
    expect(pullRequests[0]?.cursor).toBeNull();
    expect(pullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:00.000Z',
      changeId: 'desktop-1'
    });
    expect(pullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:01.000Z',
      changeId: 'desktop-2'
    });
  });

  it('fails closed with replica-specific details when one replica regresses during pull', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
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
                occurredAt: '2026-02-14T12:16:00.000Z',
                itemId: 'item-multi-replica-a'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:16:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-2',
              occurredAt: '2026-02-14T12:16:01.000Z',
              itemId: 'item-should-not-apply-mobile-regression'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:16:01.000Z',
            changeId: 'desktop-2'
          },
          lastReconciledWriteIds: {
            desktop: 9,
            mobile: 6
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 7,
        incomingWriteId: 6
      }
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply-mobile-regression'
      })
    );
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

  it('fails closed when post-restart reconcile acknowledgement regresses non-primary replica after paginated pulls', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:23:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T12:23:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const observedPulls: Array<{
      phase: 'seed' | 'resumed';
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    let reconcileCallCount = 0;
    const makeObservedTransport = (
      phase: 'seed' | 'resumed'
    ): VfsCrdtSyncTransport => ({
      pushOperations: (input) => baseTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseTransport.pullOperations(input);
        observedPulls.push({
          phase,
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              desktop: 3,
              mobile: 5
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            desktop: 4,
            mobile: 4
          }
        };
      }
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 2
    });
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = persistedSeedState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error(
        'expected seed replay cursor before reconcile regression'
      );
    }

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-regress-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T12:23:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-regress-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T12:23:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(persistedSeedState);

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    const resumedPulls = observedPulls.filter(
      (pull) => pull.phase === 'resumed'
    );
    expect(resumedPulls.length).toBe(2);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:23:02.000Z',
      changeId: 'remote-3'
    });

    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-reconcile-regress-c',
        principalId: 'org-1'
      })
    );
    const resumedCursor = resumedClient.snapshot().cursor;
    expect(resumedCursor).toEqual({
      changedAt: '2026-02-14T12:23:03.000Z',
      changeId: 'remote-4'
    });
  });

  it('recovers on subsequent cycle when reconcile acknowledgement is corrected after prior restart regression', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:24:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T12:24:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const observedPulls: Array<{
      phase: 'seed' | 'resumed';
      requestCursor: { changedAt: string; changeId: string } | null;
      items: VfsCrdtSyncItem[];
      hasMore: boolean;
      nextCursor: { changedAt: string; changeId: string } | null;
    }> = [];
    let reconcileCallCount = 0;
    const makeObservedTransport = (
      phase: 'seed' | 'resumed'
    ): VfsCrdtSyncTransport => ({
      pushOperations: (input) => baseTransport.pushOperations(input),
      pullOperations: async (input) => {
        const response = await baseTransport.pullOperations(input);
        observedPulls.push({
          phase,
          requestCursor: input.cursor ? { ...input.cursor } : null,
          items: response.items.map((item) => ({ ...item })),
          hasMore: response.hasMore,
          nextCursor: response.nextCursor ? { ...response.nextCursor } : null
        });
        return response;
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              desktop: 3,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              desktop: 4,
              mobile: 4
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            desktop: 4,
            mobile: 6
          }
        };
      }
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = persistedSeedState.replaySnapshot.cursor;
    if (!seedReplayCursor) {
      throw new Error('expected seed replay cursor before recovery test');
    }

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-recovery-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T12:24:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-recovery-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T12:24:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(persistedSeedState);

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    const postFailureSnapshot = resumedClient.snapshot();
    expect(postFailureSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(postFailureSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    const failureGuardrailCount = guardrailViolations.length;
    const recoveryResult = await resumedClient.sync();
    expect(recoveryResult).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(guardrailViolations.length).toBe(failureGuardrailCount);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 4,
      mobile: 6,
      remote: 4
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    const resumedPulls = observedPulls.filter(
      (pull) => pull.phase === 'resumed'
    );
    expect(resumedPulls.length).toBe(3);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[2]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });
    expect(resumedPulls[2]?.items).toEqual([]);
  });

  it('recovers independently across adjacent pull and reconcile regression cycles without cross-path contamination', async () => {
    let pullCallCount = 0;
    let reconcileCallCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const observedPullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCallCount += 1;
        observedPullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (pullCallCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-1',
                occurredAt: '2026-02-14T12:25:00.000Z',
                itemId: 'item-seed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:00.000Z',
              changeId: 'seed-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCallCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-regress',
                occurredAt: '2026-02-14T12:25:01.000Z',
                itemId: 'item-pull-regress-should-not-apply'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:01.000Z',
              changeId: 'pull-regress'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 3) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'post-pull-recovery',
                occurredAt: '2026-02-14T12:25:02.000Z',
                itemId: 'item-post-pull-recovery'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:25:02.000Z',
              changeId: 'post-pull-recovery'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {
            desktop: 6,
            mobile: 5
          }
        };
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            mobile: 6
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 5,
      mobile: 5
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-regress-should-not-apply'
      })
    );

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 6,
      mobile: 5
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });

    const successfulRecovery = await resumedClient.sync();
    expect(successfulRecovery).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 6,
      mobile: 6
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-post-pull-recovery'
      })
    );

    expect(
      guardrailViolations.filter((violation) => violation.stage === 'pull')
    ).toHaveLength(1);
    expect(
      guardrailViolations.filter((violation) => violation.stage === 'reconcile')
    ).toHaveLength(1);
    expect(observedPullRequests[0]?.cursor).toBeNull();
    expect(observedPullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[3]?.cursor).toEqual({
      changedAt: '2026-02-14T12:25:02.000Z',
      changeId: 'post-pull-recovery'
    });
  });

  it('converges after scripted alternating pull and reconcile failures with bounded guardrail telemetry', async () => {
    let pullCallCount = 0;
    let reconcileCallCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const observedPullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCallCount += 1;
        observedPullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (pullCallCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-1',
                occurredAt: '2026-02-14T12:26:00.000Z',
                itemId: 'item-seed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:00.000Z',
              changeId: 'seed-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCallCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-a',
                occurredAt: '2026-02-14T12:26:01.000Z',
                itemId: 'item-pull-fail-a'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:01.000Z',
              changeId: 'pull-fail-a'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 3) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'cycle-b-1',
                occurredAt: '2026-02-14T12:26:02.000Z',
                itemId: 'item-cycle-b'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:02.000Z',
              changeId: 'cycle-b-1'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 4) {
          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 5) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-d',
                occurredAt: '2026-02-14T12:26:03.000Z',
                itemId: 'item-pull-fail-d'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:03.000Z',
              changeId: 'pull-fail-d'
            },
            lastReconciledWriteIds: {
              desktop: 5,
              mobile: 6
            }
          };
        }

        if (pullCallCount === 6) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'cycle-e-1',
                occurredAt: '2026-02-14T12:26:04.000Z',
                itemId: 'item-cycle-e'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:26:04.000Z',
              changeId: 'cycle-e-1'
            },
            lastReconciledWriteIds: {
              desktop: 7,
              mobile: 6
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {
            desktop: 8,
            mobile: 8
          }
        };
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        if (reconcileCallCount === 3) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 6
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            desktop: 8,
            mobile: 8
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 5,
      mobile: 5
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    const cycleC = await resumedClient.sync();
    expect(cycleC).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    const cycleCClocks = resumedClient.snapshot().containerClocks;
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    const cycleE = await resumedClient.sync();
    expect(cycleE).toEqual({
      pulledOperations: 1,
      pullPages: 1
    });

    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 6,
        incomingWriteId: 5
      }
    });
    expect(guardrailViolations).toHaveLength(3);

    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 8
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:26:04.000Z',
      changeId: 'cycle-e-1'
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-cycle-b'
      })
    );
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-cycle-e'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-fail-a'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-pull-fail-d'
      })
    );
    const finalClocks = resumedClient.snapshot().containerClocks;
    expectContainerClocksMonotonic(cycleCClocks, finalClocks);
    const finalClockMap = toContainerClockCursorMap(finalClocks);
    expect(finalClockMap.get('item-cycle-b')?.changeId).toBe('cycle-b-1');
    expect(finalClockMap.get('item-cycle-e')?.changeId).toBe('cycle-e-1');
    expect(finalClockMap.get('item-pull-fail-a')).toBeUndefined();
    expect(finalClockMap.get('item-pull-fail-d')).toBeUndefined();

    expect(observedPullRequests[0]?.cursor).toBeNull();
    expect(observedPullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:00.000Z',
      changeId: 'seed-1'
    });
    expect(observedPullRequests[3]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
    expect(observedPullRequests[4]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
    expect(observedPullRequests[5]?.cursor).toEqual({
      changedAt: '2026-02-14T12:26:02.000Z',
      changeId: 'cycle-b-1'
    });
  });

  it('keeps listChangedContainers strictly forward after recovery cycles and excludes failed-cycle phantom containers', async () => {
    let pullCallCount = 0;
    let reconcileCallCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCallCount += 1;
        if (pullCallCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-1',
                occurredAt: '2026-02-14T12:27:00.000Z',
                itemId: 'item-seed-forward'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:00.000Z',
              changeId: 'seed-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCallCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-1',
                occurredAt: '2026-02-14T12:27:01.000Z',
                itemId: 'item-fail-phantom'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:01.000Z',
              changeId: 'pull-fail-1'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 3) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'good-1',
                occurredAt: '2026-02-14T12:27:02.000Z',
                itemId: 'item-good-1'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:27:02.000Z',
              changeId: 'good-1'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 4) {
          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'good-2',
              occurredAt: '2026-02-14T12:27:03.000Z',
              itemId: 'item-good-2'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:27:03.000Z',
            changeId: 'good-2'
          },
          lastReconciledWriteIds: {
            desktop: 7,
            mobile: 6
          }
        };
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        if (reconcileCallCount === 3) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 6
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            mobile: 7
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    const seedPage = resumedClient.listChangedContainers(null, 10);
    const seedCursor = seedPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected seed cursor before forward-window assertions');
    }

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    await resumedClient.sync();
    await resumedClient.sync();

    const forwardPage = resumedClient.listChangedContainers(seedCursor, 10);
    const forwardContainerIds = forwardPage.items.map(
      (item) => item.containerId
    );
    expect(forwardContainerIds).toContain('item-good-1');
    expect(forwardContainerIds).toContain('item-good-2');
    expect(forwardContainerIds).not.toContain('item-fail-phantom');
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
    }

    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toHaveLength(2);
  });

  it('keeps mixed acl/link container windows strictly forward after alternating failure recoveries', async () => {
    let pullCallCount = 0;
    let reconcileCallCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCallCount += 1;
        if (pullCallCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-mixed-1',
                occurredAt: '2026-02-14T12:28:00.000Z',
                itemId: 'item-seed-mixed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:00.000Z',
              changeId: 'seed-mixed-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCallCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-mixed-1',
                occurredAt: '2026-02-14T12:28:01.000Z',
                itemId: 'item-fail-phantom-mixed'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:01.000Z',
              changeId: 'pull-fail-mixed-1'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 3) {
          return {
            items: [
              {
                opId: 'good-link-1',
                itemId: 'item-good-link',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'root',
                childId: 'item-good-link',
                actorId: null,
                sourceTable: 'test',
                sourceId: 'good-link-1',
                occurredAt: '2026-02-14T12:28:02.000Z'
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:28:02.000Z',
              changeId: 'good-link-1'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 4) {
          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'good-acl-2',
              occurredAt: '2026-02-14T12:28:03.000Z',
              itemId: 'item-good-acl'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:28:03.000Z',
            changeId: 'good-acl-2'
          },
          lastReconciledWriteIds: {
            desktop: 7,
            mobile: 6
          }
        };
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        if (reconcileCallCount === 3) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 6
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            mobile: 7
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    const seedPage = resumedClient.listChangedContainers(null, 10);
    const seedCursor = seedPage.nextCursor;
    if (!seedCursor) {
      throw new Error(
        'expected seed cursor before mixed forward-window checks'
      );
    }

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    await resumedClient.sync();
    await resumedClient.sync();

    const forwardPage = resumedClient.listChangedContainers(seedCursor, 10);
    const forwardContainerIds = forwardPage.items.map(
      (item) => item.containerId
    );
    expect(forwardContainerIds).toContain('root');
    expect(forwardContainerIds).toContain('item-good-acl');
    expect(forwardContainerIds).not.toContain('item-fail-phantom-mixed');
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
    }

    expect(resumedClient.snapshot().links).toContainEqual(
      expect.objectContaining({
        parentId: 'root',
        childId: 'item-good-link'
      })
    );
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-good-acl'
      })
    );
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-fail-phantom-mixed'
      })
    );

    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toHaveLength(2);
  });

  it('keeps paginated container windows deterministic after alternating recovery failures', async () => {
    let pullCallCount = 0;
    let reconcileCallCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCallCount += 1;
        if (pullCallCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'seed-paged-1',
                occurredAt: '2026-02-14T12:29:00.000Z',
                itemId: 'item-seed-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:00.000Z',
              changeId: 'seed-paged-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCallCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'pull-fail-paged-1',
                occurredAt: '2026-02-14T12:29:01.000Z',
                itemId: 'item-phantom-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:01.000Z',
              changeId: 'pull-fail-paged-1'
            },
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 3) {
          return {
            items: [
              {
                opId: 'good-link-root-paged',
                itemId: 'item-good-link-root-paged',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'root',
                childId: 'item-good-link-root-paged',
                actorId: null,
                sourceTable: 'test',
                sourceId: 'good-link-root-paged',
                occurredAt: '2026-02-14T12:29:02.000Z'
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:02.000Z',
              changeId: 'good-link-root-paged'
            },
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 4) {
          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {
              desktop: 6,
              mobile: 5
            }
          };
        }

        if (pullCallCount === 5) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'good-acl-paged',
                occurredAt: '2026-02-14T12:29:03.000Z',
                itemId: 'item-good-acl-paged'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:29:03.000Z',
              changeId: 'good-acl-paged'
            },
            lastReconciledWriteIds: {
              desktop: 7,
              mobile: 6
            }
          };
        }

        return {
          items: [
            {
              opId: 'good-link-archive-paged',
              itemId: 'item-good-link-archive-paged',
              opType: 'link_add',
              principalType: null,
              principalId: null,
              accessLevel: null,
              parentId: 'archive',
              childId: 'item-good-link-archive-paged',
              actorId: null,
              sourceTable: 'test',
              sourceId: 'good-link-archive-paged',
              occurredAt: '2026-02-14T12:29:04.000Z'
            }
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:29:04.000Z',
            changeId: 'good-link-archive-paged'
          },
          lastReconciledWriteIds: {
            desktop: 8,
            mobile: 7
          }
        };
      },
      reconcileState: async (input) => {
        reconcileCallCount += 1;
        if (reconcileCallCount === 1) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 5
            }
          };
        }

        if (reconcileCallCount === 2) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 4
            }
          };
        }

        if (reconcileCallCount === 3) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 6
            }
          };
        }

        if (reconcileCallCount === 4) {
          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 7
            }
          };
        }

        return {
          cursor: { ...input.cursor },
          lastReconciledWriteIds: {
            ...input.lastReconciledWriteIds,
            mobile: 8
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    await seedClient.sync();

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message,
            details: violation.details
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());

    const seedPage = resumedClient.listChangedContainers(null, 10);
    const seedCursor = seedPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected seed cursor for paginated window checks');
    }

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica desktop/
    );
    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    await resumedClient.sync();
    await resumedClient.sync();
    await resumedClient.sync();

    const pageOne = resumedClient.listChangedContainers(seedCursor, 1);
    const pageOneCursor = pageOne.nextCursor;
    if (!pageOneCursor) {
      throw new Error('expected first paginated forward cursor');
    }
    const pageTwo = resumedClient.listChangedContainers(pageOneCursor, 1);
    const pageTwoCursor = pageTwo.nextCursor;
    if (!pageTwoCursor) {
      throw new Error('expected second paginated forward cursor');
    }
    const pageThree = resumedClient.listChangedContainers(pageTwoCursor, 1);

    expect(pageOne.items).toHaveLength(1);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageThree.items).toHaveLength(1);
    expect(pageOne.hasMore).toBe(true);
    expect(pageTwo.hasMore).toBe(true);
    expect(pageThree.hasMore).toBe(false);

    const pagedItems = [...pageOne.items, ...pageTwo.items, ...pageThree.items];
    expect(pagedItems.map((item) => item.containerId)).toEqual([
      'root',
      'item-good-acl-paged',
      'archive'
    ]);
    expect(pagedItems.map((item) => item.changeId)).toEqual([
      'good-link-root-paged',
      'good-acl-paged',
      'good-link-archive-paged'
    ]);
    expect(pagedItems.map((item) => item.containerId)).not.toContain(
      'item-phantom-paged'
    );
    expect(pagedItems.map((item) => item.changeId)).not.toContain(
      seedCursor.changeId
    );
    for (const item of pagedItems) {
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
    expect(
      compareVfsSyncCursorOrder(pageTwoCursor, pageOneCursor)
    ).toBeGreaterThan(0);
    if (!pageThree.nextCursor) {
      throw new Error('expected terminal paginated cursor');
    }
    expect(
      compareVfsSyncCursorOrder(pageThree.nextCursor, pageTwoCursor)
    ).toBeGreaterThan(0);

    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'desktop',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });
    expect(guardrailViolations).toHaveLength(2);
  });

  it('keeps deterministic paginated container windows across randomized mixed recovery seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const parentOne = pickOne(parentCandidates, random);
      const parentTwo = pickDifferent(parentCandidates, parentOne, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const itemSeed = `item-seed-rand-${seed}`;
      const itemPhantom = `item-phantom-rand-${seed}`;
      const itemGoodAcl = `item-good-acl-rand-${seed}`;
      const itemGoodLinkOne = `item-good-link-one-rand-${seed}`;
      const itemGoodLinkTwo = `item-good-link-two-rand-${seed}`;

      const baseMs = Date.parse('2026-02-14T12:30:00.000Z') + seed * 10_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      let pullCallCount = 0;
      let reconcileCallCount = 0;
      const guardrailViolations: Array<{
        code: string;
        stage: string;
        message: string;
        details?: Record<string, string | number | boolean | null>;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async () => ({
          results: []
        }),
        pullOperations: async () => {
          pullCallCount += 1;
          if (pullCallCount === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `seed-${seed}-1`,
                  occurredAt: at(0),
                  itemId: itemSeed
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(0),
                changeId: `seed-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 5
              }
            };
          }

          if (pullCallCount === 2) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `pull-fail-${seed}-1`,
                  occurredAt: at(1),
                  itemId: itemPhantom
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(1),
                changeId: `pull-fail-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 4,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 3) {
            return {
              items: [
                {
                  opId: `good-link-${seed}-1`,
                  itemId: itemGoodLinkOne,
                  opType: 'link_add',
                  principalType: null,
                  principalId: null,
                  accessLevel: null,
                  parentId: parentOne,
                  childId: itemGoodLinkOne,
                  actorId: null,
                  sourceTable: 'test',
                  sourceId: `good-link-${seed}-1`,
                  occurredAt: at(2)
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(2),
                changeId: `good-link-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 4) {
            return {
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 5) {
            return {
              items: [
                {
                  ...buildAclAddSyncItem({
                    opId: `good-acl-${seed}-1`,
                    occurredAt: at(3),
                    itemId: itemGoodAcl
                  }),
                  principalType,
                  principalId: `${principalType}-${seed}`,
                  accessLevel
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(3),
                changeId: `good-acl-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 7,
                mobile: 6
              }
            };
          }

          return {
            items: [
              {
                opId: `good-link-${seed}-2`,
                itemId: itemGoodLinkTwo,
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: parentTwo,
                childId: itemGoodLinkTwo,
                actorId: null,
                sourceTable: 'test',
                sourceId: `good-link-${seed}-2`,
                occurredAt: at(4)
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(4),
              changeId: `good-link-${seed}-2`
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        },
        reconcileState: async (input) => {
          reconcileCallCount += 1;
          if (reconcileCallCount === 1) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 5
              }
            };
          }

          if (reconcileCallCount === 2) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 4
              }
            };
          }

          if (reconcileCallCount === 3) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 6
              }
            };
          }

          if (reconcileCallCount === 4) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 7
              }
            };
          }

          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 8
            }
          };
        }
      };

      const seedClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage,
              message: violation.message,
              details: violation.details
            });
          }
        }
      );
      await seedClient.sync();

      const resumedClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage,
              message: violation.message,
              details: violation.details
            });
          }
        }
      );
      resumedClient.hydrateState(seedClient.exportState());

      const seedPage = resumedClient.listChangedContainers(null, 10);
      const seedCursor = seedPage.nextCursor;
      if (!seedCursor) {
        throw new Error('expected seed cursor before randomized pagination');
      }

      await expect(resumedClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica desktop/
      );
      await expect(resumedClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica mobile/
      );
      await resumedClient.sync();
      await resumedClient.sync();
      await resumedClient.sync();

      const pageSignatures: string[] = [];
      let paginationCursor = seedCursor;
      for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
        const page = resumedClient.listChangedContainers(paginationCursor, 1);
        const item = page.items[0];
        if (!item) {
          throw new Error(`expected paginated item ${pageIndex + 1}`);
        }

        pageSignatures.push(`${item.containerId}|${item.changeId}`);
        expect(
          compareVfsSyncCursorOrder(
            {
              changedAt: item.changedAt,
              changeId: item.changeId
            },
            seedCursor
          )
        ).toBeGreaterThan(0);
        expect(item.containerId).not.toBe(itemPhantom);
        expect(item.changeId).not.toBe(seedCursor.changeId);

        const nextCursor = page.nextCursor;
        if (!nextCursor) {
          throw new Error(`expected next cursor for page ${pageIndex + 1}`);
        }
        expect(
          compareVfsSyncCursorOrder(nextCursor, paginationCursor)
        ).toBeGreaterThan(0);
        paginationCursor = nextCursor;
      }
      const terminalPage = resumedClient.listChangedContainers(
        paginationCursor,
        1
      );
      expect(terminalPage.items).toEqual([]);
      expect(terminalPage.hasMore).toBe(false);

      expect(pageSignatures).toEqual([
        `${parentOne}|good-link-${seed}-1`,
        `${itemGoodAcl}|good-acl-${seed}-1`,
        `${parentTwo}|good-link-${seed}-2`
      ]);
      const guardrailSignatures = guardrailViolations.map((violation) => {
        const replicaId = violation.details?.['replicaId'];
        return `${violation.stage}:${violation.code}:${typeof replicaId === 'string' ? replicaId : 'none'}`;
      });
      expect(guardrailSignatures).toEqual([
        'pull:lastWriteIdRegression:desktop',
        'reconcile:lastWriteIdRegression:mobile'
      ]);

      return {
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1224, 1225, 1226] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });

  it('preserves seeded paginated recovery signatures across mid-chain export and hydrate restarts', async () => {
    const runContinuationScenario = async (
      seed: number,
      withMidRestart: boolean
    ): Promise<{
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const parentOne = pickOne(parentCandidates, random);
      const parentTwo = pickDifferent(parentCandidates, parentOne, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const itemSeed = `item-seed-mid-${seed}`;
      const itemPhantom = `item-phantom-mid-${seed}`;
      const itemGoodAcl = `item-good-acl-mid-${seed}`;
      const itemGoodLinkOne = `item-good-link-one-mid-${seed}`;
      const itemGoodLinkTwo = `item-good-link-two-mid-${seed}`;

      const baseMs = Date.parse('2026-02-14T12:31:00.000Z') + seed * 10_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      let pullCallCount = 0;
      let reconcileCallCount = 0;
      const guardrailViolations: Array<{
        code: string;
        stage: string;
        message: string;
        details?: Record<string, string | number | boolean | null>;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async () => ({
          results: []
        }),
        pullOperations: async () => {
          pullCallCount += 1;
          if (pullCallCount === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `seed-mid-${seed}-1`,
                  occurredAt: at(0),
                  itemId: itemSeed
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(0),
                changeId: `seed-mid-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 5
              }
            };
          }

          if (pullCallCount === 2) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `pull-fail-mid-${seed}-1`,
                  occurredAt: at(1),
                  itemId: itemPhantom
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(1),
                changeId: `pull-fail-mid-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 4,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 3) {
            return {
              items: [
                {
                  opId: `good-link-mid-${seed}-1`,
                  itemId: itemGoodLinkOne,
                  opType: 'link_add',
                  principalType: null,
                  principalId: null,
                  accessLevel: null,
                  parentId: parentOne,
                  childId: itemGoodLinkOne,
                  actorId: null,
                  sourceTable: 'test',
                  sourceId: `good-link-mid-${seed}-1`,
                  occurredAt: at(2)
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(2),
                changeId: `good-link-mid-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 4) {
            return {
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 5) {
            return {
              items: [
                {
                  ...buildAclAddSyncItem({
                    opId: `good-acl-mid-${seed}-1`,
                    occurredAt: at(3),
                    itemId: itemGoodAcl
                  }),
                  principalType,
                  principalId: `${principalType}-mid-${seed}`,
                  accessLevel
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(3),
                changeId: `good-acl-mid-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 7,
                mobile: 6
              }
            };
          }

          return {
            items: [
              {
                opId: `good-link-mid-${seed}-2`,
                itemId: itemGoodLinkTwo,
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: parentTwo,
                childId: itemGoodLinkTwo,
                actorId: null,
                sourceTable: 'test',
                sourceId: `good-link-mid-${seed}-2`,
                occurredAt: at(4)
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(4),
              changeId: `good-link-mid-${seed}-2`
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        },
        reconcileState: async (input) => {
          reconcileCallCount += 1;
          if (reconcileCallCount === 1) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 5
              }
            };
          }

          if (reconcileCallCount === 2) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 4
              }
            };
          }

          if (reconcileCallCount === 3) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 6
              }
            };
          }

          if (reconcileCallCount === 4) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 7
              }
            };
          }

          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 8
            }
          };
        }
      };

      const makeClient = (): VfsBackgroundSyncClient =>
        new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage,
              message: violation.message,
              details: violation.details
            });
          }
        });

      const seedClient = makeClient();
      await seedClient.sync();

      let activeClient = makeClient();
      activeClient.hydrateState(seedClient.exportState());

      const seedPage = activeClient.listChangedContainers(null, 10);
      const seedCursor = seedPage.nextCursor;
      if (!seedCursor) {
        throw new Error('expected seed cursor before mid-chain continuation');
      }

      await expect(activeClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica desktop/
      );
      await expect(activeClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica mobile/
      );
      await activeClient.sync();

      if (withMidRestart) {
        const midState = activeClient.exportState();
        activeClient = makeClient();
        activeClient.hydrateState(midState);
      }

      await activeClient.sync();
      await activeClient.sync();

      const pageOne = activeClient.listChangedContainers(seedCursor, 1);
      const pageOneCursor = pageOne.nextCursor;
      if (!pageOneCursor) {
        throw new Error('expected first continuation page cursor');
      }
      const pageTwo = activeClient.listChangedContainers(pageOneCursor, 1);
      const pageTwoCursor = pageTwo.nextCursor;
      if (!pageTwoCursor) {
        throw new Error('expected second continuation page cursor');
      }
      const pageThree = activeClient.listChangedContainers(pageTwoCursor, 1);
      const pageSignatures = [
        ...pageOne.items.map((item) => `${item.containerId}|${item.changeId}`),
        ...pageTwo.items.map((item) => `${item.containerId}|${item.changeId}`),
        ...pageThree.items.map((item) => `${item.containerId}|${item.changeId}`)
      ];
      expect(pageSignatures).toEqual([
        `${parentOne}|good-link-mid-${seed}-1`,
        `${itemGoodAcl}|good-acl-mid-${seed}-1`,
        `${parentTwo}|good-link-mid-${seed}-2`
      ]);
      expect(pageOne.hasMore).toBe(true);
      expect(pageTwo.hasMore).toBe(true);
      expect(pageThree.hasMore).toBe(false);
      expect(pageSignatures).not.toContain(
        `${itemPhantom}|pull-fail-mid-${seed}-1`
      );

      const guardrailSignatures = guardrailViolations.map((violation) => {
        const replicaId = violation.details?.['replicaId'];
        return `${violation.stage}:${violation.code}:${typeof replicaId === 'string' ? replicaId : 'none'}`;
      });
      expect(guardrailSignatures).toEqual([
        'pull:lastWriteIdRegression:desktop',
        'reconcile:lastWriteIdRegression:mobile'
      ]);

      return {
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1331, 1332] as const;
    for (const seed of seeds) {
      const baseline = await runContinuationScenario(seed, false);
      const restarted = await runContinuationScenario(seed, true);
      expect(restarted).toEqual(baseline);
    }
  });

  it('preserves pending-order and paginated windows when resuming from mid-chain checkpoint with queued locals', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      pushedOpIds: string[];
      pushedWriteIds: number[];
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const parentRecovered = pickOne(parentCandidates, random);
      const parentLocal = pickDifferent(
        parentCandidates,
        parentRecovered,
        random
      );

      const itemSeed = `item-seed-pending-${seed}`;
      const itemPhantom = `item-phantom-pending-${seed}`;
      const itemRecovered = `item-recovered-pending-${seed}`;
      const localAclItem = `item-local-acl-pending-${seed}`;
      const localLinkItem = `item-local-link-pending-${seed}`;
      const localAclOpId = `local-acl-op-${seed}`;
      const localLinkOpId = `local-link-op-${seed}`;

      const baseMs = Date.parse('2026-02-14T12:32:00.000Z') + seed * 10_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      let pullCallCount = 0;
      let reconcileCallCount = 0;
      const pushedOpIds: string[] = [];
      const pushedWriteIds: number[] = [];
      const guardrailViolations: Array<{
        code: string;
        stage: string;
        message: string;
        details?: Record<string, string | number | boolean | null>;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          for (const operation of input.operations) {
            pushedOpIds.push(operation.opId);
            pushedWriteIds.push(operation.writeId);
          }
          return {
            results: input.operations.map((operation) => ({
              opId: operation.opId,
              status: 'applied' as const
            }))
          };
        },
        pullOperations: async () => {
          pullCallCount += 1;
          if (pullCallCount === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `seed-pending-${seed}-1`,
                  occurredAt: at(0),
                  itemId: itemSeed
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(0),
                changeId: `seed-pending-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 5
              }
            };
          }

          if (pullCallCount === 2) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: `pull-fail-pending-${seed}-1`,
                  occurredAt: at(1),
                  itemId: itemPhantom
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(1),
                changeId: `pull-fail-pending-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 4,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 3) {
            return {
              items: [
                {
                  opId: `good-link-pending-${seed}-1`,
                  itemId: itemRecovered,
                  opType: 'link_add',
                  principalType: null,
                  principalId: null,
                  accessLevel: null,
                  parentId: parentRecovered,
                  childId: itemRecovered,
                  actorId: null,
                  sourceTable: 'test',
                  sourceId: `good-link-pending-${seed}-1`,
                  occurredAt: at(2)
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(2),
                changeId: `good-link-pending-${seed}-1`
              },
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 4) {
            return {
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {
                desktop: 6,
                mobile: 5
              }
            };
          }

          if (pullCallCount === 5) {
            return {
              items: [
                {
                  ...buildAclAddSyncItem({
                    opId: localAclOpId,
                    occurredAt: at(3),
                    itemId: localAclItem
                  }),
                  principalType: 'group',
                  principalId: `group-pending-${seed}`,
                  accessLevel: 'write'
                }
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(3),
                changeId: localAclOpId
              },
              lastReconciledWriteIds: {
                desktop: 7,
                mobile: 6
              }
            };
          }

          return {
            items: [
              {
                opId: localLinkOpId,
                itemId: localLinkItem,
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: parentLocal,
                childId: localLinkItem,
                actorId: null,
                sourceTable: 'test',
                sourceId: localLinkOpId,
                occurredAt: at(4)
              }
            ],
            hasMore: false,
            nextCursor: {
              changedAt: at(4),
              changeId: localLinkOpId
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        },
        reconcileState: async (input) => {
          reconcileCallCount += 1;
          if (reconcileCallCount === 1) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 5
              }
            };
          }

          if (reconcileCallCount === 2) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 4
              }
            };
          }

          if (reconcileCallCount === 3) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 6
              }
            };
          }

          if (reconcileCallCount === 4) {
            return {
              cursor: { ...input.cursor },
              lastReconciledWriteIds: {
                ...input.lastReconciledWriteIds,
                mobile: 7
              }
            };
          }

          return {
            cursor: { ...input.cursor },
            lastReconciledWriteIds: {
              ...input.lastReconciledWriteIds,
              mobile: 8
            }
          };
        }
      };

      const makeClient = (): VfsBackgroundSyncClient =>
        new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage,
              message: violation.message,
              details: violation.details
            });
          }
        });

      const seedClient = makeClient();
      await seedClient.sync();

      let activeClient = makeClient();
      activeClient.hydrateState(seedClient.exportState());
      const seedPage = activeClient.listChangedContainers(null, 10);
      const seedCursor = seedPage.nextCursor;
      if (!seedCursor) {
        throw new Error(
          'expected seed cursor before pending checkpoint scenario'
        );
      }

      await expect(activeClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica desktop/
      );
      await expect(activeClient.sync()).rejects.toThrowError(
        /regressed lastReconciledWriteIds for replica mobile/
      );
      await activeClient.sync();

      activeClient.queueLocalOperation({
        opType: 'acl_add',
        opId: localAclOpId,
        itemId: localAclItem,
        principalType: 'group',
        principalId: `group-pending-${seed}`,
        accessLevel: 'write',
        occurredAt: at(1)
      });
      activeClient.queueLocalOperation({
        opType: 'link_add',
        opId: localLinkOpId,
        itemId: localLinkItem,
        parentId: parentLocal,
        childId: localLinkItem,
        occurredAt: at(1)
      });

      const midState = activeClient.exportState();
      activeClient = makeClient();
      activeClient.hydrateState(midState);

      await activeClient.flush();
      await activeClient.sync();

      const pageOne = activeClient.listChangedContainers(seedCursor, 1);
      const pageOneCursor = pageOne.nextCursor;
      if (!pageOneCursor) {
        throw new Error('expected first page cursor in pending continuation');
      }
      const pageTwo = activeClient.listChangedContainers(pageOneCursor, 1);
      const pageTwoCursor = pageTwo.nextCursor;
      if (!pageTwoCursor) {
        throw new Error('expected second page cursor in pending continuation');
      }
      const pageThree = activeClient.listChangedContainers(pageTwoCursor, 1);
      const pageSignatures = [
        ...pageOne.items.map((item) => `${item.containerId}|${item.changeId}`),
        ...pageTwo.items.map((item) => `${item.containerId}|${item.changeId}`),
        ...pageThree.items.map((item) => `${item.containerId}|${item.changeId}`)
      ];
      expect(pageSignatures).toEqual([
        `${parentRecovered}|good-link-pending-${seed}-1`,
        `${localAclItem}|${localAclOpId}`,
        `${parentLocal}|${localLinkOpId}`
      ]);

      const guardrailSignatures = guardrailViolations.map((violation) => {
        const replicaId = violation.details?.['replicaId'];
        return `${violation.stage}:${violation.code}:${typeof replicaId === 'string' ? replicaId : 'none'}`;
      });
      expect(guardrailSignatures).toEqual([
        'pull:lastWriteIdRegression:desktop',
        'reconcile:lastWriteIdRegression:mobile'
      ]);
      expect(pushedOpIds).toEqual([localAclOpId, localLinkOpId]);
      expect(pushedWriteIds).toEqual([7, 8]);

      return {
        pushedOpIds,
        pushedWriteIds,
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1441, 1442] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });

  it('fails closed on malformed queued local op in checkpointed pending state and preserves target paginated windows', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-seed-1',
          opType: 'acl_add',
          itemId: 'item-seed-malformed-pending',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:33:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();
    sourceClient.queueLocalOperation({
      opType: 'acl_add',
      opId: 'local-acl-malformed',
      itemId: 'item-local-acl-malformed',
      principalType: 'group',
      principalId: 'group-local',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:33:01.000Z'
    });
    sourceClient.queueLocalOperation({
      opType: 'link_add',
      opId: 'local-link-malformed',
      itemId: 'item-local-link-malformed',
      parentId: 'root',
      childId: 'item-local-link-malformed',
      occurredAt: '2026-02-14T12:33:02.000Z'
    });

    const malformedState = sourceClient.exportState();
    const malformedPending = malformedState.pendingOperations[1];
    if (!malformedPending) {
      throw new Error('expected second pending operation to corrupt');
    }
    malformedPending.childId = 'item-local-link-malformed-mismatch';

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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
    const pristineState = targetClient.exportState();
    const pristineFirstPage = targetClient.listChangedContainers(null, 1);
    const pristineSecondPage = targetClient.listChangedContainers(
      pristineFirstPage.nextCursor,
      1
    );

    expect(() => targetClient.hydrateState(malformedState)).toThrow(
      'state.pendingOperations[1] has link childId that does not match itemId'
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message:
          'state.pendingOperations[1] has link childId that does not match itemId'
      }
    ]);
    expect(targetClient.exportState()).toEqual(pristineState);
    expect(targetClient.listChangedContainers(null, 1)).toEqual(
      pristineFirstPage
    );
    expect(
      targetClient.listChangedContainers(pristineFirstPage.nextCursor, 1)
    ).toEqual(pristineSecondPage);
    expect(pushedOperationCount).toBe(0);
  });

  it('recovers with corrected checkpoint payload after malformed pending rejection and preserves push ordering', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-seed-recovery-1',
          opType: 'acl_add',
          itemId: 'item-seed-recovery-pending',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:34:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();
    sourceClient.queueLocalOperation({
      opType: 'acl_add',
      opId: 'local-acl-recovery',
      itemId: 'item-local-acl-recovery',
      principalType: 'group',
      principalId: 'group-local-recovery',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:34:01.000Z'
    });
    sourceClient.queueLocalOperation({
      opType: 'link_add',
      opId: 'local-link-recovery',
      itemId: 'item-local-link-recovery',
      parentId: 'root',
      childId: 'item-local-link-recovery',
      occurredAt: '2026-02-14T12:34:02.000Z'
    });

    const correctedState = sourceClient.exportState();
    const malformedState = sourceClient.exportState();
    const malformedPending = malformedState.pendingOperations[1];
    if (!malformedPending) {
      throw new Error(
        'expected second pending operation to corrupt for recovery'
      );
    }
    malformedPending.childId = 'item-local-link-recovery-mismatch';

    const pushedOpIds: string[] = [];
    const pushedWriteIds: number[] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOpIds.push(
          ...input.operations.map((operation) => operation.opId)
        );
        pushedWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
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

    expect(() => targetClient.hydrateState(malformedState)).toThrow(
      'state.pendingOperations[1] has link childId that does not match itemId'
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message:
          'state.pendingOperations[1] has link childId that does not match itemId'
      }
    ]);

    expect(() => targetClient.hydrateState(correctedState)).not.toThrow();
    const seedPage = targetClient.listChangedContainers(null, 10);
    const seedCursor = seedPage.nextCursor;
    if (!seedCursor) {
      throw new Error('expected seed cursor before corrected recovery flush');
    }

    await targetClient.flush();

    expect(pushedOpIds).toEqual(['local-acl-recovery', 'local-link-recovery']);
    expect(pushedWriteIds).toEqual([1, 2]);
    expect(targetClient.snapshot().pendingOperations).toBe(0);

    const forwardPage = targetClient.listChangedContainers(seedCursor, 10);
    const forwardContainerIds = forwardPage.items.map(
      (item) => item.containerId
    );
    expect(forwardContainerIds).toContain('item-local-acl-recovery');
    expect(forwardContainerIds).toContain('root');
    expect(guardrailViolations).toHaveLength(1);
  });

  it('keeps corrected-checkpoint recovery signatures deterministic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      pushedOpIds: string[];
      pushedWriteIds: number[];
      pageSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const parentCandidates = ['root', 'archive', 'workspace'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const parentId = pickOne(parentCandidates, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const itemSeed = `item-seed-corrected-${seed}`;
      const itemLocalAcl = `item-local-acl-corrected-${seed}`;
      const itemLocalLink = `item-local-link-corrected-${seed}`;
      const localAclOpId = `local-acl-corrected-${seed}`;
      const localLinkOpId = `local-link-corrected-${seed}`;

      const baseMs = Date.parse('2026-02-14T12:35:00.000Z') + seed * 10_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      const server = new InMemoryVfsCrdtSyncServer();
      await server.pushOperations({
        operations: [
          {
            opId: `remote-seed-corrected-${seed}`,
            opType: 'acl_add',
            itemId: itemSeed,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType: 'group',
            principalId: 'group-seed',
            accessLevel: 'read'
          }
        ]
      });
      const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
      const sourceClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        baseTransport
      );
      await sourceClient.sync();
      sourceClient.queueLocalOperation({
        opType: 'acl_add',
        opId: localAclOpId,
        itemId: itemLocalAcl,
        principalType,
        principalId: `${principalType}-corrected-${seed}`,
        accessLevel,
        occurredAt: at(1)
      });
      sourceClient.queueLocalOperation({
        opType: 'link_add',
        opId: localLinkOpId,
        itemId: itemLocalLink,
        parentId,
        childId: itemLocalLink,
        occurredAt: at(2)
      });

      const correctedState = sourceClient.exportState();
      const malformedState = sourceClient.exportState();
      const malformedPending = malformedState.pendingOperations[1];
      if (!malformedPending) {
        throw new Error(
          'expected second pending operation for correction seed'
        );
      }
      malformedPending.childId = `${itemLocalLink}-mismatch`;

      const pushedOpIds: string[] = [];
      const pushedWriteIds: number[] = [];
      const guardrailViolations: Array<{
        code: string;
        stage: string;
        message: string;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          pushedOpIds.push(
            ...input.operations.map((operation) => operation.opId)
          );
          pushedWriteIds.push(
            ...input.operations.map((operation) => operation.writeId)
          );
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
      const targetClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
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

      expect(() => targetClient.hydrateState(malformedState)).toThrow(
        'state.pendingOperations[1] has link childId that does not match itemId'
      );
      expect(() => targetClient.hydrateState(correctedState)).not.toThrow();

      const seedPage = targetClient.listChangedContainers(null, 10);
      const seedCursor = seedPage.nextCursor;
      if (!seedCursor) {
        throw new Error('expected seed cursor in corrected deterministic run');
      }

      await targetClient.flush();

      const pageOne = targetClient.listChangedContainers(seedCursor, 1);
      const pageOneCursor = pageOne.nextCursor;
      if (!pageOneCursor) {
        throw new Error('expected first corrected page cursor');
      }
      const pageTwo = targetClient.listChangedContainers(pageOneCursor, 1);
      const pageSignatures = [
        ...pageOne.items.map((item) => `${item.containerId}|${item.changeId}`),
        ...pageTwo.items.map((item) => `${item.containerId}|${item.changeId}`)
      ];
      expect(pageSignatures).toEqual([
        `${itemLocalAcl}|${localAclOpId}`,
        `${parentId}|${localLinkOpId}`
      ]);

      expect(pushedOpIds).toEqual([localAclOpId, localLinkOpId]);
      expect(pushedWriteIds).toEqual([1, 2]);
      const guardrailSignatures = guardrailViolations.map(
        (violation) => `${violation.stage}:${violation.code}`
      );
      expect(guardrailSignatures).toEqual([
        'hydrate:hydrateGuardrailViolation'
      ]);

      return {
        pushedOpIds,
        pushedWriteIds,
        pageSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1551, 1552, 1553] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });

  it('keeps corrected-checkpoint recovery stable across pull and container window pagination boundaries', async () => {
    const runScenario = async (input: {
      seed: number;
      pullLimit: number;
      containerWindowLimit: number;
    }): Promise<{
      forwardSignatures: string[];
      pulledOpIds: string[];
      pullCursorSignatures: string[];
      guardrailSignatures: string[];
    }> => {
      const random = createDeterministicRandom(input.seed);
      const localParents = ['root', 'archive', 'workspace'] as const;
      const remoteParents = ['projects', 'teams', 'inbox'] as const;
      const principalTypes = ['group', 'organization'] as const;
      const accessLevels = ['read', 'write', 'admin'] as const;
      const localParentId = pickOne(localParents, random);
      const remoteParentId = pickOne(remoteParents, random);
      const principalType = pickOne(principalTypes, random);
      const accessLevel = pickOne(accessLevels, random);

      const remoteSeedOpId = `remote-seed-boundary-${input.seed}`;
      const remoteAclOpId = `remote-acl-boundary-${input.seed}`;
      const remoteLinkOpId = `remote-link-boundary-${input.seed}`;
      const localAclOpId = `local-acl-boundary-${input.seed}`;
      const localLinkOpId = `local-link-boundary-${input.seed}`;

      const itemSeed = `item-seed-boundary-${input.seed}`;
      const itemRemoteAcl = `item-remote-acl-boundary-${input.seed}`;
      const itemRemoteLink = `item-remote-link-boundary-${input.seed}`;
      const itemLocalAcl = `item-local-acl-boundary-${input.seed}`;
      const itemLocalLink = `item-local-link-boundary-${input.seed}`;

      const baseMs =
        Date.parse('2026-02-14T13:10:00.000Z') + input.seed * 1_000;
      const at = (offsetSeconds: number): string =>
        new Date(baseMs + offsetSeconds * 1_000).toISOString();

      const server = new InMemoryVfsCrdtSyncServer();
      await server.pushOperations({
        operations: [
          {
            opId: remoteSeedOpId,
            opType: 'acl_add',
            itemId: itemSeed,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType: 'group',
            principalId: `group-seed-boundary-${input.seed}`,
            accessLevel: 'read'
          }
        ]
      });
      const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
      const sourceClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        baseTransport,
        {
          pullLimit: input.pullLimit
        }
      );
      await sourceClient.sync();
      sourceClient.queueLocalOperation({
        opType: 'acl_add',
        opId: localAclOpId,
        itemId: itemLocalAcl,
        principalType,
        principalId: `${principalType}-local-boundary-${input.seed}`,
        accessLevel,
        occurredAt: at(1)
      });
      sourceClient.queueLocalOperation({
        opType: 'link_add',
        opId: localLinkOpId,
        itemId: itemLocalLink,
        parentId: localParentId,
        childId: itemLocalLink,
        occurredAt: at(2)
      });

      const correctedState = sourceClient.exportState();
      const malformedState = sourceClient.exportState();
      const malformedPending = malformedState.pendingOperations[1];
      if (!malformedPending) {
        throw new Error('expected malformed pending operation in boundary run');
      }
      malformedPending.childId = `${itemLocalLink}-mismatch`;

      /**
       * Guardrail harness behavior: append remote changes after checkpoint export
       * so resumed sync must cross both push and pull pagination boundaries while
       * still preserving deterministic forward container windows.
       */
      await server.pushOperations({
        operations: [
          {
            opId: remoteAclOpId,
            opType: 'acl_add',
            itemId: itemRemoteAcl,
            replicaId: 'remote',
            writeId: 2,
            occurredAt: at(3),
            principalType: 'group',
            principalId: `group-remote-boundary-${input.seed}`,
            accessLevel: 'write'
          },
          {
            opId: remoteLinkOpId,
            opType: 'link_add',
            itemId: itemRemoteLink,
            replicaId: 'remote',
            writeId: 3,
            occurredAt: at(4),
            parentId: remoteParentId,
            childId: itemRemoteLink
          }
        ]
      });

      const pulledOpIds: string[] = [];
      const pullCursorSignatures: string[] = [];
      const guardrailViolations: Array<{
        code: string;
        stage: string;
      }> = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: (pushInput) => baseTransport.pushOperations(pushInput),
        pullOperations: async (pullInput) => {
          const cursorSignature = pullInput.cursor
            ? `${pullInput.cursor.changedAt}|${pullInput.cursor.changeId}`
            : 'null';
          pullCursorSignatures.push(cursorSignature);
          const response = await baseTransport.pullOperations(pullInput);
          pulledOpIds.push(...response.items.map((item) => item.opId));
          return response;
        },
        reconcileState: async (reconcileInput) => {
          if (baseTransport.reconcileState) {
            return baseTransport.reconcileState(reconcileInput);
          }

          return {
            cursor: reconcileInput.cursor,
            lastReconciledWriteIds: server.snapshot().lastReconciledWriteIds
          };
        }
      };
      const targetClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        transport,
        {
          pullLimit: input.pullLimit,
          onGuardrailViolation: (violation) => {
            guardrailViolations.push({
              code: violation.code,
              stage: violation.stage
            });
          }
        }
      );

      expect(() => targetClient.hydrateState(malformedState)).toThrow(
        'state.pendingOperations[1] has link childId that does not match itemId'
      );
      expect(() => targetClient.hydrateState(correctedState)).not.toThrow();

      const seedPage = targetClient.listChangedContainers(null, 20);
      const seedCursor = seedPage.nextCursor;
      if (!seedCursor) {
        throw new Error('expected seed cursor in boundary perturbation run');
      }

      await targetClient.flush();

      const readForwardSignatures = (limit: number): string[] => {
        const signatures: string[] = [];
        let cursor = seedCursor;
        while (true) {
          const page = targetClient.listChangedContainers(cursor, limit);
          for (const item of page.items) {
            const itemCursor = {
              changedAt: item.changedAt,
              changeId: item.changeId
            };
            expect(compareVfsSyncCursorOrder(itemCursor, seedCursor)).toBe(1);
            if (cursor) {
              expect(compareVfsSyncCursorOrder(itemCursor, cursor)).toBe(1);
            }
            signatures.push(`${item.containerId}|${item.changeId}`);
          }

          if (!page.hasMore) {
            break;
          }

          if (!page.nextCursor) {
            throw new Error('expected nextCursor when hasMore is true');
          }

          if (cursor) {
            expect(compareVfsSyncCursorOrder(page.nextCursor, cursor)).toBe(1);
          }
          cursor = page.nextCursor;
        }

        return signatures;
      };

      const fullWindowSignatures = readForwardSignatures(100);
      const pagedWindowSignatures = readForwardSignatures(
        input.containerWindowLimit
      );
      expect(pagedWindowSignatures).toEqual(fullWindowSignatures);
      expect(fullWindowSignatures).toEqual([
        `${itemLocalAcl}|${localAclOpId}`,
        `${localParentId}|${localLinkOpId}`,
        `${itemRemoteAcl}|${remoteAclOpId}`,
        `${remoteParentId}|${remoteLinkOpId}`
      ]);
      expect(pulledOpIds).toEqual([
        localAclOpId,
        localLinkOpId,
        remoteAclOpId,
        remoteLinkOpId
      ]);
      expect(new Set(pulledOpIds).size).toBe(pulledOpIds.length);
      expect(pulledOpIds).not.toContain(remoteSeedOpId);

      const guardrailSignatures = guardrailViolations.map(
        (violation) => `${violation.stage}:${violation.code}`
      );
      expect(guardrailSignatures).toEqual([
        'hydrate:hydrateGuardrailViolation'
      ]);

      return {
        forwardSignatures: fullWindowSignatures,
        pulledOpIds,
        pullCursorSignatures,
        guardrailSignatures
      };
    };

    const seeds = [1661, 1662] as const;
    const configs = [
      {
        pullLimit: 1,
        containerWindowLimit: 1
      },
      {
        pullLimit: 1,
        containerWindowLimit: 2
      },
      {
        pullLimit: 2,
        containerWindowLimit: 1
      },
      {
        pullLimit: 3,
        containerWindowLimit: 3
      }
    ] as const;

    for (const seed of seeds) {
      let expectedForwardSignatures: string[] | null = null;
      for (const config of configs) {
        const firstRun = await runScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });
        const secondRun = await runScenario({
          seed,
          pullLimit: config.pullLimit,
          containerWindowLimit: config.containerWindowLimit
        });
        expect(secondRun).toEqual(firstRun);

        if (!expectedForwardSignatures) {
          expectedForwardSignatures = firstRun.forwardSignatures;
        } else {
          expect(firstRun.forwardSignatures).toEqual(expectedForwardSignatures);
        }
      }
    }
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
