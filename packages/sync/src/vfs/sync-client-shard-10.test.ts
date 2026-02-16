import { describe, expect, it } from 'vitest';
import type {
  ObservedPhasePullPage,
  VfsCrdtSyncTransport
} from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
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
  it('fails closed when post-restart pull cycle regresses write ids below local reconcile baseline', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCount += 1;
        pullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:15:00.000Z',
                itemId: 'item-baseline-a'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:15:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-2',
                occurredAt: '2026-02-14T12:15:01.000Z',
                itemId: 'item-baseline-b'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:15:01.000Z',
              changeId: 'desktop-2'
            },
            lastReconciledWriteIds: {
              desktop: 6
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-3',
              occurredAt: '2026-02-14T12:15:02.000Z',
              itemId: 'item-should-not-apply'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:15:02.000Z',
            changeId: 'desktop-3'
          },
          lastReconciledWriteIds: {
            desktop: 5
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
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
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds.desktop).toBe(6);

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
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state'
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply'
      })
    );
    expect(pullRequests[0]?.cursor).toBeNull();
    expect(pullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:00.000Z',
      changeId: 'desktop-1'
    });
    expect(pullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:01.000Z',
      changeId: 'desktop-2'
    });
  });

  it('fails closed with replica-specific details when one replica regresses during pull', async () => {
    let pullCount = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:16:00.000Z',
                itemId: 'item-multi-replica-a'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:16:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-2',
              occurredAt: '2026-02-14T12:16:01.000Z',
              itemId: 'item-should-not-apply-mobile-regression'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:16:01.000Z',
            changeId: 'desktop-2'
          },
          lastReconciledWriteIds: {
            desktop: 9,
            mobile: 6
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 7,
        incomingWriteId: 6
      }
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply-mobile-regression'
      })
    );
  });

  it('applies transport reconcile acknowledgements when supported', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-1',
            occurredAt: '2026-02-14T12:20:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:20:00.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:01.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2,
          mobile: 4
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    await client.sync();

    const snapshot = client.snapshot();
    expect(snapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:20:01.000Z',
      changeId: 'desktop-2'
    });
    expect(snapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 4
    });
    expect(snapshot.nextLocalWriteId).toBe(3);
  });

  it('fails closed when reconcile acknowledgement regresses cursor', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:21:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:21:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:20:59.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
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
    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'reconcileCursorRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed sync cursor'
    });
  });

  it('fails closed when reconcile acknowledgement regresses last write ids', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-2',
            occurredAt: '2026-02-14T12:22:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 2
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-14T12:22:00.000Z',
          changeId: 'desktop-2'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
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
    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'reconcile',
      message: 'reconcile acknowledgement regressed replica write-id state'
    });
  });

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
