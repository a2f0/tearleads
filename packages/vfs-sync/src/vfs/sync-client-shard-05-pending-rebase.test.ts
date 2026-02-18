import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
