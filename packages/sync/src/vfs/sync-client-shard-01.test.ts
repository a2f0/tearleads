import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  wait,
  waitFor
} from './sync-client-test-support.js';

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
});
