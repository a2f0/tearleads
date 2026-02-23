import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  VfsBackgroundSyncClient,
  wait,
  waitFor
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
    const preFailureState = client.exportState();

    await expect(client.sync()).rejects.toThrowError(
      /nextCursor that does not match pull page tail/
    );
    expect(client.exportState()).toEqual(preFailureState);
  });

  it('fails closed when transport returns hasMore=true with an empty page', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [],
        hasMore: true,
        nextCursor: null,
        lastReconciledWriteIds: {}
      })
    };
    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    const preFailureState = client.exportState();

    await expect(client.sync()).rejects.toThrowError(
      /hasMore=true with an empty pull page/
    );
    expect(client.exportState()).toEqual(preFailureState);
  });

  it('recovers after transient empty-page invariant failure without leaking partial state', async () => {
    let pullCount = 0;
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [],
            hasMore: true,
            nextCursor: null,
            lastReconciledWriteIds: {}
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-recovery-1',
              occurredAt: '2026-02-14T12:06:00.000Z',
              itemId: 'item-recovery'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:06:00.000Z',
            changeId: 'desktop-recovery-1'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
        };
      }
    };
    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      pullLimit: 1
    });
    const preFailureState = client.exportState();

    await expect(client.sync()).rejects.toThrowError(
      /hasMore=true with an empty pull page/
    );
    expect(client.exportState()).toEqual(preFailureState);

    const recoveryResult = await client.sync();
    expect(recoveryResult).toEqual({
      pulledOperations: 1,
      pullPages: 1
    });
    expect(client.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:06:00.000Z',
      changeId: 'desktop-recovery-1'
    });
  });

  it('fails closed when pull pagination replays a duplicate opId in one sync cycle', async () => {
    let client: VfsBackgroundSyncClient | null = null;
    let pullCount = 0;
    let stateBeforeSecondPull: ReturnType<
      VfsBackgroundSyncClient['exportState']
    > | null = null;
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

        stateBeforeSecondPull = client?.exportState() ?? null;
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
    client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
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
    expect(stateBeforeSecondPull).not.toBeNull();
    expect(client.exportState()).toEqual(stateBeforeSecondPull);
  });

  it('fails closed when a later pull page regresses the local cursor', async () => {
    let client: VfsBackgroundSyncClient | null = null;
    let pullCount = 0;
    let stateBeforeSecondPull: ReturnType<
      VfsBackgroundSyncClient['exportState']
    > | null = null;
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
                opId: 'desktop-forward-2',
                occurredAt: '2026-02-14T12:05:00.000Z',
                itemId: 'item-forward'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:05:00.000Z',
              changeId: 'desktop-forward-2'
            },
            lastReconciledWriteIds: {
              desktop: 2
            }
          };
        }

        stateBeforeSecondPull = client?.exportState() ?? null;
        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-regress-1',
              occurredAt: '2026-02-14T12:04:59.000Z',
              itemId: 'item-regress'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:59.000Z',
            changeId: 'desktop-regress-1'
          },
          lastReconciledWriteIds: {
            desktop: 2
          }
        };
      }
    };
    client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      pullLimit: 1
    });

    await expect(client.sync()).rejects.toThrowError(
      /transport returned regressing sync cursor/
    );
    expect(stateBeforeSecondPull).not.toBeNull();
    expect(client.exportState()).toEqual(stateBeforeSecondPull);
  });
});
