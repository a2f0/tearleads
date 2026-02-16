import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  expectContainerClocksMonotonic,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readSeedContainerCursorOrThrow,
  VfsBackgroundSyncClient,
  waitFor
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed on regressing reconcile lineage after a prior restart cycle and preserves pristine state', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-regressed-cycle',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:28:00.000Z',
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

    const cycleOnePersisted = sourceClient.exportState();
    cycleOnePersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:28:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 6
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:27:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:27:58.000Z',
        parentId: 'root',
        childId: 'item-regressed-cycle'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();

    const preRegressionServerSnapshot = server.snapshot();
    const cycleTwoPersisted = cycleOneClient.exportState();
    const cycleTwoReplayCursor = cycleTwoPersisted.replaySnapshot.cursor;
    if (!cycleTwoReplayCursor) {
      throw new Error('expected replay cursor before regression cycle');
    }
    cycleTwoPersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:27:55.000Z',
        changeId: 'remote-regressed'
      },
      lastReconciledWriteIds: {
        desktop: 8
      }
    };
    cycleTwoPersisted.pendingOperations = [
      {
        opId: 'desktop-16',
        opType: 'acl_remove',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:27:57.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-regressed-cycle',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:27:56.000Z',
        parentId: 'root',
        childId: 'item-regressed-cycle'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 1;

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const trackingTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      trackingTransport,
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
    const pristineState = cycleTwoClient.exportState();

    expect(() => cycleTwoClient.hydrateState(cycleTwoPersisted)).toThrow(
      'persisted reconcile cursor regressed persisted replay cursor'
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message: 'persisted reconcile cursor regressed persisted replay cursor'
      }
    ]);
    expect(cycleTwoClient.exportState()).toEqual(pristineState);
    expect(pushedOperationCount).toBe(0);
    expect(server.snapshot()).toEqual(preRegressionServerSnapshot);

    expect(
      compareVfsSyncCursorOrder(
        cycleTwoReplayCursor,
        cycleTwoPersisted.reconcileState.cursor
      )
    ).toBeGreaterThan(0);
  });

  it('fails closed when hydrated reconcile write ids are invalid and keeps state pristine', () => {
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
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:12:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 0
      }
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /invalid writeId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'lastReconciledWriteIds contains invalid writeId (must be a positive integer)'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrating while background flush is active', async () => {
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
    client.startBackgroundFlush(50);

    expect(() => client.hydrateState(persisted)).toThrowError(
      /background flush is active/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while background flush is active'
    });

    await client.stopBackgroundFlush(false);
  });

  it('fails closed when hydrating while flush is in progress', async () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const server = new InMemoryVfsCrdtSyncServer();
    let pushStarted = false;
    let releasePush: (() => void) | null = null;
    const pushGate = new Promise<void>((resolve) => {
      releasePush = resolve;
    });

    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushStarted = true;
        await pushGate;
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

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });

    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hydrate-flush',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:21:00.000Z'
    });

    const flushPromise = client.flush();
    await waitFor(() => pushStarted, 1000);

    const stateBeforeHydrate = client.exportState();
    const persisted = client.exportState();
    expect(() => client.hydrateState(persisted)).toThrowError(
      /flush is in progress/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'cannot hydrate state while flush is in progress'
    });
    expect(client.exportState()).toEqual(stateBeforeHydrate);

    if (!releasePush) {
      throw new Error('missing push release hook');
    }
    releasePush();
    await flushPromise;
    expect(client.snapshot().pendingOperations).toBe(0);
  });

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

  it('returns only strictly newer container clocks when reusing pre-restart cursor', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
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
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:26:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:26:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const seedCursor = readSeedContainerCursorOrThrow({
      client: desktop,
      pageLimit: 10,
      errorMessage: 'expected pre-restart seed cursor'
    });

    const persistedState = desktop.exportState();
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedState);

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-seed-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:26:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const pageAfterRestart = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(pageAfterRestart.items.length).toBeGreaterThan(0);
    expect(pageAfterRestart.items).toContainEqual({
      containerId: 'item-seed-c',
      changedAt: '2026-02-14T14:26:02.000Z',
      changeId: 'mobile-3'
    });

    for (const item of pageAfterRestart.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('returns stable empty pages when reusing pre-restart cursor with no new writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 3,
      pullDelayMs: 3
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 4
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
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stable-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:27:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-stable-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:27:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const seedCursor = readSeedContainerCursorOrThrow({
      client: desktop,
      pageLimit: 10,
      errorMessage: 'expected pre-restart seed cursor'
    });

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const firstEmptyPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    const secondEmptyPage = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );

    expect(firstEmptyPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });
    expect(secondEmptyPage).toEqual(firstEmptyPage);
  });
});
