import { describe, expect, it } from 'vitest';
import type {
  ObservedPhasePullPage,
  ObservedPhaseReconcileSnapshot,
  ObservedPullPage,
  VfsCrdtSyncTransport
} from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  compareVfsSyncCursorOrder,
  createPhasePullRecordingTransportFactory,
  createPhaseReconcileRecordingHandler,
  createPullRecordingTransport,
  filterObservedPullsByPhase,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('keeps replay cursor monotonic across sequential replica handoff cycles', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
    });
    const tabletTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 5
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );
    const tablet = new VfsBackgroundSyncClient(
      'user-1',
      'tablet',
      tabletTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:34:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedDesktopState,
      errorMessage: 'expected replay seed cursor before handoff cycles'
    });

    const observedPulls: ObservedPullPage[] = [];
    const observingDesktopTransport = createPullRecordingTransport({
      baseTransport: desktopTransport,
      observedPulls
    });

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      observingDesktopTransport,
      { pullLimit: 1 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);
    await resumedDesktop.sync();
    expect(observedPulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(observedPulls[0]?.items).toEqual([]);

    const cycleOneStart = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-handoff-a',
      parentId: 'root',
      childId: 'item-handoff-a',
      occurredAt: '2026-02-14T14:34:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:34:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleOnePulls = observedPulls.slice(cycleOneStart);
    expect(cycleOnePulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleOnePulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(cycleOnePulls[cycleOnePulls.length - 1]?.hasMore).toBe(false);

    const cycleOneItems = cycleOnePulls.flatMap((page) => page.items);
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-2',
        opType: 'link_add',
        itemId: 'item-handoff-a'
      })
    );
    expect(cycleOneItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-3',
        opType: 'acl_add',
        itemId: 'item-handoff-b'
      })
    );

    const cycleOneTerminalCursor =
      cycleOnePulls[cycleOnePulls.length - 1]?.nextCursor;
    expect(cycleOneTerminalCursor).not.toBeNull();
    if (!cycleOneTerminalCursor) {
      throw new Error('expected cycle one handoff terminal cursor');
    }

    const cycleTwoStart = observedPulls.length;

    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-handoff-c',
      parentId: 'root',
      childId: 'item-handoff-c',
      occurredAt: '2026-02-14T14:34:03.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-handoff-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:34:04.000Z'
    });
    await tablet.flush();
    await resumedDesktop.sync();

    const cycleTwoPulls = observedPulls.slice(cycleTwoStart);
    expect(cycleTwoPulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleTwoPulls[0]?.requestCursor).toEqual(cycleOneTerminalCursor);
    expect(cycleTwoPulls[cycleTwoPulls.length - 1]?.hasMore).toBe(false);

    /**
     * Guardrail invariant: switching write source replicas across cycles must
     * not reset cursor progression or replay prior cycle boundary rows.
     */
    const cycleTwoItems = cycleTwoPulls.flatMap((page) => page.items);
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-1',
        opType: 'link_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-2',
        opType: 'acl_add',
        itemId: 'item-handoff-c'
      })
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      cycleOneTerminalCursor.changeId
    );
    expect(cycleTwoItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of cycleTwoItems) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.occurredAt,
            changeId: item.opId
          },
          cycleOneTerminalCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('avoids boundary replay across restart paginated pulls while write-id baselines stay monotonic', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-boundary-a',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:35:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'remote-2',
          opType: 'acl_add',
          itemId: 'item-boundary-b',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T14:35:01.000Z',
          principalType: 'group',
          principalId: 'group-2',
          accessLevel: 'write'
        }
      ]
    });

    const observedPulls: ObservedPhasePullPage[] = [];
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const makeObservedTransport = createPhasePullRecordingTransportFactory({
      baseTransport,
      observedPulls,
      includeLastReconciledWriteIds: true
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
    expect(seedClient.snapshot().lastReconciledWriteIds.remote).toBe(2);

    const persistedSeedState = seedClient.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedSeedState,
      errorMessage: 'expected replay seed cursor before restart'
    });

    await server.pushOperations({
      operations: [
        {
          opId: 'remote-3',
          opType: 'link_add',
          itemId: 'item-boundary-c',
          replicaId: 'remote',
          writeId: 3,
          occurredAt: '2026-02-14T14:35:02.000Z',
          parentId: 'root',
          childId: 'item-boundary-c'
        },
        {
          opId: 'remote-4',
          opType: 'acl_add',
          itemId: 'item-boundary-c',
          replicaId: 'remote',
          writeId: 4,
          occurredAt: '2026-02-14T14:35:03.000Z',
          principalType: 'organization',
          principalId: 'org-1',
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
    expect(resumedPulls[0]?.lastReconciledWriteIds?.remote).toBe(4);
    expect(resumedPulls[1]?.requestCursor).toEqual({
      changedAt: '2026-02-14T14:35:02.000Z',
      changeId: 'remote-3'
    });
    expect(resumedPulls[1]?.items.map((item) => item.opId)).toEqual([
      'remote-4'
    ]);
    expect(resumedPulls[1]?.hasMore).toBe(false);

    const resumedPulledOpIds = resumedPulls.flatMap((pull) =>
      pull.items.map((item) => item.opId)
    );
    expect(resumedPulledOpIds).not.toContain(seedReplayCursor.changeId);
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

    expect(resumedGuardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().lastReconciledWriteIds.remote).toBe(4);
    const resumedCursor = resumedClient.snapshot().cursor;
    if (!resumedCursor) {
      throw new Error('expected resumed cursor');
    }
    expect(
      compareVfsSyncCursorOrder(resumedCursor, seedReplayCursor)
    ).toBeGreaterThan(0);
  });

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

  it('fails closed when hydrating on a non-empty client state', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:20:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const client = new VfsBackgroundSyncClient(
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

    await client.sync();
    const stateBeforeHydrate = client.exportState();
    const persisted = client.exportState();

    expect(() => client.hydrateState(persisted)).toThrowError(
      /non-empty client/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state on a non-empty client'
    });
    expect(client.exportState()).toEqual(stateBeforeHydrate);
  });

  it('drains queue after idempotent retry when first push fails post-commit', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    let firstAttempt = true;

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        if (firstAttempt) {
          firstAttempt = false;
          await server.pushOperations({
            operations: input.operations
          });
          throw new Error('connection dropped after commit');
        }

        return server.pushOperations({
          operations: input.operations
        });
      },
      pullOperations: async (input) =>
        server.pullOperations({
          cursor: input.cursor,
          limit: input.limit
        })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:11:00.000Z'
    });

    await expect(client.flush()).rejects.toThrowError(/connection dropped/);
    expect(client.snapshot().pendingOperations).toBe(1);

    const retry = await client.flush();
    expect(retry.pushedOperations).toBe(1);
    expect(client.snapshot().pendingOperations).toBe(0);
    expect(client.snapshot().acl).toEqual(server.snapshot().acl);
  });

  it('fails closed when transport push response is malformed', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
        lastReconciledWriteIds: {}
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport);
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:12:00.000Z'
    });

    await expect(client.flush()).rejects.toThrowError(
      /mismatched push response/
    );
    expect(client.snapshot().pendingOperations).toBe(1);
  });

  it('fails closed when pull pages regress last reconciled write ids', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
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
                occurredAt: '2026-02-14T12:13:00.000Z'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:13:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 2
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-2',
              occurredAt: '2026-02-14T12:13:01.000Z'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:13:01.000Z',
            changeId: 'desktop-2'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
        };
      }
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
    await expect(client.sync()).rejects.toThrowError(/regressed/);
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state'
    });
  });
});
