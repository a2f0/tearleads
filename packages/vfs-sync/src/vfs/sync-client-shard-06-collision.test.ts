import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
