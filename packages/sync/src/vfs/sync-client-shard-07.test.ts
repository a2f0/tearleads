import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  waitFor
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
