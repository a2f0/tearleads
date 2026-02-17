import { describe, expect, it } from 'vitest';
import type { ObservedPhasePullPage } from './sync-client-test-support.js';
import {
  createGuardrailViolationCollector,
  createPhasePullRecordingTransportFactory,
  createPhaseReconcileRecordingHandler,
  filterObservedPullsByPhase,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed when post-restart reconcile acknowledgement regresses non-primary replica after paginated pulls', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:23:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T12:23:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const observedPulls: ObservedPhasePullPage[] = [];
    const reconcileState = createPhaseReconcileRecordingHandler({
      resolve: ({ reconcileInput, callCount }) => {
        if (callCount === 1) {
          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
              desktop: 3,
              mobile: 5
            }
          };
        }

        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            desktop: 4,
            mobile: 4
          }
        };
      }
    });
    const makeObservedTransport = createPhasePullRecordingTransportFactory({
      baseTransport,
      observedPulls,
      reconcileState
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 2
    });
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedSeedState,
      errorMessage: 'expected seed replay cursor before reconcile regression'
    });

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-regress-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T12:23:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-regress-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-regress-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T12:23:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(persistedSeedState);

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    const resumedPulls = filterObservedPullsByPhase({
      observedPulls,
      phase: 'resumed'
    });
    expect(resumedPulls.length).toBe(2);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:23:02.000Z',
      changeId: 'remote-3'
    });

    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(resumedClient.snapshot().acl).toContainEqual(
      expect.objectContaining({
        itemId: 'item-reconcile-regress-c',
        principalId: 'org-1'
      })
    );
    const resumedCursor = resumedClient.snapshot().cursor;
    expect(resumedCursor).toEqual({
      changedAt: '2026-02-14T12:23:03.000Z',
      changeId: 'remote-4'
    });
  });

  it('recovers on subsequent cycle when reconcile acknowledgement is corrected after prior restart regression', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:24:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T12:24:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const observedPulls: ObservedPhasePullPage[] = [];
    const reconcileState = createPhaseReconcileRecordingHandler({
      resolve: ({ reconcileInput, callCount }) => {
        if (callCount === 1) {
          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
              desktop: 3,
              mobile: 5
            }
          };
        }

        if (callCount === 2) {
          return {
            cursor: { ...reconcileInput.cursor },
            lastReconciledWriteIds: {
              ...reconcileInput.lastReconciledWriteIds,
              desktop: 4,
              mobile: 4
            }
          };
        }

        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: {
            ...reconcileInput.lastReconciledWriteIds,
            desktop: 4,
            mobile: 6
          }
        };
      }
    });
    const makeObservedTransport = createPhasePullRecordingTransportFactory({
      baseTransport,
      observedPulls,
      reconcileState
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    await seedClient.sync();
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedSeedState,
      errorMessage: 'expected seed replay cursor before recovery test'
    });

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-recovery-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T12:24:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-recovery-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-recovery-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T12:24:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(persistedSeedState);

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 5,
        incomingWriteId: 4
      }
    });

    const postFailureSnapshot = resumedClient.snapshot();
    expect(postFailureSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 4
    });
    expect(postFailureSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    const failureGuardrailCount = guardrailViolations.length;
    const recoveryResult = await resumedClient.sync();
    expect(recoveryResult).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(guardrailViolations.length).toBe(failureGuardrailCount);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 4,
      mobile: 6,
      remote: 4
    });
    expect(resumedClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });

    const resumedPulls = filterObservedPullsByPhase({
      observedPulls,
      phase: 'resumed'
    });
    expect(resumedPulls.length).toBe(3);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[2]?.requestCursor).toEqual({
      changedAt: '2026-02-14T12:24:03.000Z',
      changeId: 'remote-4'
    });
    expect(resumedPulls[2]?.items).toEqual([]);
  });
});
