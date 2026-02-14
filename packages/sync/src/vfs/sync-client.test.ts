import type { VfsCrdtSyncItem } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport
} from './sync-client-harness.js';
import {
  VfsCrdtSyncPushRejectedError,
  VfsBackgroundSyncClient,
  type VfsCrdtSyncTransport
} from './sync-client.js';

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
    const mobile = new VfsBackgroundSyncClient('user-1', 'mobile', mobileTransport, {
      pullLimit: 1
    });

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

  it('keeps queued writes when server rejects push due to stale write ids', async () => {
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

    await expect(client.flush()).rejects.toBeInstanceOf(
      VfsCrdtSyncPushRejectedError
    );
    expect(client.snapshot().pendingOperations).toBe(1);
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

    await expect(client.flush()).rejects.toThrowError(/mismatched push response/);
    expect(client.snapshot().pendingOperations).toBe(1);
  });

  it('fails closed when pull pages regress last reconciled write ids', async () => {
    let pullCount = 0;
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

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    await expect(client.sync()).rejects.toThrowError(/regressed/);
  });

  it('fails closed when transport regresses cursor with no items', async () => {
    let pullCount = 0;
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

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    await client.sync();
    await expect(client.sync()).rejects.toThrowError(/regressing sync cursor/);
  });
});
