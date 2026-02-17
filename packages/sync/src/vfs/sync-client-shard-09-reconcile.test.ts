import { describe, expect, it } from 'vitest';
import type {
  ObservedPhasePullPage,
  ObservedPhaseReconcileSnapshot
} from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createPhasePullRecordingTransportFactory,
  createPhaseReconcileRecordingHandler,
  filterObservedPullsByPhase,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('merges reconcile transport clocks monotonically across restart paginated pull cycles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-reconcile-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:36:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-reconcile-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T14:36:01.000Z',
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'write'
        }
      ]
    });

    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const observedPulls: ObservedPhasePullPage[] = [];
    const observedReconcileInputs: ObservedPhaseReconcileSnapshot[] = [];
    const observedReconcileResponses: ObservedPhaseReconcileSnapshot[] = [];
    const reconcileState = createPhaseReconcileRecordingHandler({
      observedInputs: observedReconcileInputs,
      observedResponses: observedReconcileResponses,
      resolve: ({ reconcileInput, callCount }) => {
        const reconciledWriteIds =
          callCount === 1
            ? {
                ...reconcileInput.lastReconciledWriteIds,
                desktop: 3,
                mobile: 5
              }
            : {
                ...reconcileInput.lastReconciledWriteIds,
                desktop: 7,
                mobile: 9
              };
        return {
          cursor: { ...reconcileInput.cursor },
          lastReconciledWriteIds: reconciledWriteIds
        };
      }
    });
    const makeObservedTransport = createPhasePullRecordingTransportFactory({
      baseTransport,
      observedPulls,
      includeLastReconciledWriteIds: true,
      reconcileState
    });

    const seedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('seed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          seedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedGuardrailViolations).toEqual([]);
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 5,
      remote: 2
    });
    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedSeedState,
      errorMessage: 'expected replay cursor before reconcile restart cycle'
    });

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-reconcile-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T14:36:02.000Z',
          parentId: 'root',
          childId: 'item-reconcile-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-reconcile-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T14:36:03.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'admin'
        }
      ]
    });

    const resumedGuardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      makeObservedTransport('resumed'),
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          resumedGuardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    resumedClient.hydrateState(persistedSeedState);
    await resumedClient.sync();

    const resumedPulls = filterObservedPullsByPhase({
      observedPulls,
      phase: 'resumed'
    });
    expect(resumedPulls.length).toBe(2);
    expect(resumedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(resumedPulls[0]?.items.map((item) => item.opId)).toEqual([
      'remote-3'
    ]);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T14:36:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[1]?.items.map((item) => item.opId)).toEqual([
      'remote-4'
    ]);
    expect(
      resumedPulls.flatMap((pull) => pull.items.map((item) => item.opId))
    ).not.toContain(seedReplayCursor.changeId);

    for (const pull of resumedPulls) {
      for (const item of pull.items) {
        expect(
          compareVfsSyncCursorOrder(
            {
              changedAt: item.occurredAt,
              changeId: item.opId
            },
            seedReplayCursor
          )
        ).toBeGreaterThan(0);
      }
    }

    expect(observedReconcileInputs).toEqual([
      {
        phase: 'seed',
        cursor: {
          changedAt: '2026-02-14T14:36:01.000Z',
          changeId: 'remote-2'
        },
        lastReconciledWriteIds: {
          remote: 2
        }
      },
      {
        phase: 'resumed',
        cursor: {
          changedAt: '2026-02-14T14:36:03.000Z',
          changeId: 'remote-4'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 5,
          remote: 4
        }
      }
    ]);
    expect(observedReconcileResponses).toEqual([
      {
        phase: 'seed',
        cursor: {
          changedAt: '2026-02-14T14:36:01.000Z',
          changeId: 'remote-2'
        },
        lastReconciledWriteIds: {
          desktop: 3,
          mobile: 5,
          remote: 2
        }
      },
      {
        phase: 'resumed',
        cursor: {
          changedAt: '2026-02-14T14:36:03.000Z',
          changeId: 'remote-4'
        },
        lastReconciledWriteIds: {
          desktop: 7,
          mobile: 9,
          remote: 4
        }
      }
    ]);
    expect(resumedGuardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 7,
      mobile: 9,
      remote: 4
    });
  });
});
