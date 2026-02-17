import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  expectContainerClocksMonotonic,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  waitFor
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('preserves cross-client convergence after hydrate rejection during in-flight flush', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releaseDesktopPush: (() => void) | null = null;
    const desktopPushGate = new Promise<void>((resolve) => {
      releaseDesktopPush = resolve;
    });

    const desktopTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await desktopPushGate;
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
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 2
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
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
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-desktop',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:22:02.000Z'
    });
    const desktopFlushPromise = desktop.flush();
    await waitFor(() => pushStarted, 1000);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mobile',
      parentId: 'root',
      childId: 'item-mobile',
      occurredAt: '2026-02-14T14:22:01.000Z'
    });
    await mobile.flush();
    await mobile.sync();
    const mobileSnapshotBeforeDesktopResume = mobile.snapshot();

    const desktopStateBeforeHydrate = desktop.exportState();
    const desktopPersisted = desktop.exportState();
    expect(() => desktop.hydrateState(desktopPersisted)).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });
    expect(desktop.exportState()).toEqual(desktopStateBeforeHydrate);

    if (!releaseDesktopPush) {
      throw new Error('missing desktop push release hook');
    }
    releaseDesktopPush();
    await desktopFlushPromise;
    for (let index = 0; index < 3; index++) {
      await Promise.all([desktop.sync(), mobile.sync()]);
    }

    const serverSnapshot = server.snapshot();
    const desktopSnapshot = desktop.snapshot();
    const mobileSnapshot = mobile.snapshot();

    expect(desktopSnapshot.pendingOperations).toBe(0);
    expect(mobileSnapshot.pendingOperations).toBe(0);
    expect(desktopSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(mobileSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(desktopSnapshot.links).toEqual(serverSnapshot.links);
    expect(mobileSnapshot.links).toEqual(serverSnapshot.links);
    expect(desktopSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(mobileSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expectContainerClocksMonotonic(
      desktopStateBeforeHydrate.containerClocks,
      desktopSnapshot.containerClocks
    );
    expectContainerClocksMonotonic(
      mobileSnapshotBeforeDesktopResume.containerClocks,
      mobileSnapshot.containerClocks
    );
  });

  it('keeps listChangedContainers pagination forward-only after hydrate rejection race', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releaseDesktopPush: (() => void) | null = null;
    const desktopPushGate = new Promise<void>((resolve) => {
      releaseDesktopPush = resolve;
    });

    const desktopTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await desktopPushGate;
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
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 2
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
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
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:24:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const baselinePage = desktop.listChangedContainers(null, 1);
    const baselineCursor = baselinePage.nextCursor;
    if (!baselineCursor) {
      throw new Error('expected baseline container cursor');
    }

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-desktop',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:24:02.000Z'
    });
    const desktopFlushPromise = desktop.flush();
    await waitFor(() => pushStarted, 1000);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mobile',
      parentId: 'root',
      childId: 'item-mobile',
      occurredAt: '2026-02-14T14:24:01.000Z'
    });
    await mobile.flush();
    await mobile.sync();

    expect(() => desktop.hydrateState(desktop.exportState())).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });

    if (!releaseDesktopPush) {
      throw new Error('missing desktop push release hook');
    }
    releaseDesktopPush();
    await desktopFlushPromise;

    for (let index = 0; index < 3; index++) {
      await Promise.all([desktop.sync(), mobile.sync()]);
    }

    const firstPageAfterBaseline = desktop.listChangedContainers(
      baselineCursor,
      1
    );
    expect(firstPageAfterBaseline.items.length).toBe(1);
    const firstCursor = firstPageAfterBaseline.nextCursor;
    if (!firstCursor) {
      throw new Error('expected pagination cursor after first forward page');
    }
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: firstPageAfterBaseline.items[0]?.changedAt ?? '',
          changeId: firstPageAfterBaseline.items[0]?.changeId ?? ''
        },
        baselineCursor
      )
    ).toBeGreaterThan(0);

    const secondPageAfterBaseline = desktop.listChangedContainers(
      firstCursor,
      10
    );
    for (const item of secondPageAfterBaseline.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          firstCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('preserves container-clock pagination boundaries across export and hydrate restart', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 4,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 5
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-rt-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:25:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-rt-2',
      parentId: 'root',
      childId: 'item-rt-2',
      occurredAt: '2026-02-14T14:25:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const firstPageBefore = desktop.listChangedContainers(null, 1);
    const secondPageBefore = desktop.listChangedContainers(
      firstPageBefore.nextCursor,
      1
    );
    const thirdPageBefore = desktop.listChangedContainers(
      secondPageBefore.nextCursor,
      10
    );

    const persistedState = desktop.exportState();
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedState);

    const firstPageAfter = resumedDesktop.listChangedContainers(null, 1);
    const secondPageAfter = resumedDesktop.listChangedContainers(
      firstPageAfter.nextCursor,
      1
    );
    const thirdPageAfter = resumedDesktop.listChangedContainers(
      secondPageAfter.nextCursor,
      10
    );

    expect(firstPageAfter).toEqual(firstPageBefore);
    expect(secondPageAfter).toEqual(secondPageBefore);
    expect(thirdPageAfter).toEqual(thirdPageBefore);
  });
});
