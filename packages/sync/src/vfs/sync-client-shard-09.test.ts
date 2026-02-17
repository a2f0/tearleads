import { describe, expect, it } from 'vitest';
import type {
  ObservedPhasePullPage,
  ObservedPullPage
} from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createPhasePullRecordingTransportFactory,
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
});
