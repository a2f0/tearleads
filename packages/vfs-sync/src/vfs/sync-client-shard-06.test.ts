import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
