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
});
