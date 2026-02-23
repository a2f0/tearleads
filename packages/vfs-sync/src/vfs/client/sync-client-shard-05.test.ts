import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
