import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
