import { describe, expect, it } from 'vitest';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed when hydrated pending operations reference another replica', () => {
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
        opId: 'mobile-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T14:10:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /replicaId that does not match clientId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has replicaId that does not match clientId'
    });
  });

  it('fails closed when hydrated link pending operation has mismatched childId', () => {
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
        opId: 'desktop-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T14:11:00.000Z',
        parentId: 'root',
        childId: 'item-2'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /childId that does not match itemId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has link childId that does not match itemId'
    });
  });

  it('fails closed when hydrated replay cursor is malformed and keeps state pristine', () => {
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
      changedAt: 'not-a-date',
      changeId: 'desktop-1'
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /invalid persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'transport returned invalid persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated reconcile cursor trails replay cursor and keeps state pristine', () => {
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
      changedAt: '2026-02-14T14:12:01.000Z',
      changeId: 'desktop-2'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:12:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /persisted reconcile cursor regressed persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'persisted reconcile cursor regressed persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('hydrates when replay, reconcile, and container clock cursors share an equal boundary', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate-equal',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:12:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error('expected replay cursor for equal-boundary hydrate test');
    }
    const boundaryClock = persisted.containerClocks.find(
      (entry) => entry.containerId === 'item-hydrate-equal'
    );
    if (!boundaryClock) {
      throw new Error(
        'expected container clock for equal-boundary hydrate test'
      );
    }
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: boundaryClock.changedAt,
          changeId: boundaryClock.changeId
        },
        replayCursor
      )
    ).toBe(0);

    persisted.reconcileState = {
      cursor: {
        changedAt: replayCursor.changedAt,
        changeId: replayCursor.changeId
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
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
    expect(guardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().cursor).toEqual(replayCursor);
  });
});
