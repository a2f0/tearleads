import { describe, expect, it } from 'vitest';
import type { ObservedPullPage } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createPullRecordingTransport,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('reuses replay cursor across restart without boundary replay in mixed acl+link pull stream', async () => {
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
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:31:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-replay-a',
      parentId: 'root',
      childId: 'item-replay-a',
      occurredAt: '2026-02-14T14:31:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedDesktopState,
      errorMessage: 'expected mixed pre-restart replay seed cursor'
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

    const pullsBeforeNewWrites = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:31:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-replay-a',
      parentId: 'root',
      childId: 'item-replay-a',
      occurredAt: '2026-02-14T14:31:03.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPulls = observedPulls.slice(pullsBeforeNewWrites);
    expect(forwardPulls.length).toBeGreaterThan(0);
    expect(forwardPulls[0]?.requestCursor).toEqual(seedReplayCursor);

    const forwardItems = forwardPulls.flatMap((page) => page.items);
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-3',
        opType: 'acl_add',
        itemId: 'item-replay-b'
      })
    );
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-4',
        opType: 'link_remove',
        itemId: 'item-replay-a'
      })
    );
    expect(forwardItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of forwardItems) {
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
  });

  it('keeps replay cursor strict-forward across restart with concurrent multi-replica writes', async () => {
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
      itemId: 'item-replay-concurrent-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:32:00.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-replay-concurrent-b',
      parentId: 'root',
      childId: 'item-replay-concurrent-b',
      occurredAt: '2026-02-14T14:32:01.000Z'
    });
    await Promise.all([mobile.flush(), tablet.flush()]);
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedDesktopState,
      errorMessage: 'expected multi-replica pre-restart replay seed cursor'
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

    const pullsBeforeNewWrites = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-replay-concurrent-c',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:32:02.000Z'
    });
    tablet.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-replay-concurrent-b',
      parentId: 'root',
      childId: 'item-replay-concurrent-b',
      occurredAt: '2026-02-14T14:32:03.000Z'
    });
    await Promise.all([mobile.flush(), tablet.flush()]);
    await resumedDesktop.sync();

    const forwardPulls = observedPulls.slice(pullsBeforeNewWrites);
    expect(forwardPulls.length).toBeGreaterThanOrEqual(2);
    expect(forwardPulls[0]?.requestCursor).toEqual(seedReplayCursor);

    const forwardItems = forwardPulls.flatMap((page) => page.items);
    expect(forwardPulls[forwardPulls.length - 1]?.hasMore).toBe(false);

    for (let index = 0; index < forwardPulls.length; index++) {
      const page = forwardPulls[index];
      if (!page) {
        continue;
      }

      if (page.requestCursor) {
        expect(
          compareVfsSyncCursorOrder(page.requestCursor, seedReplayCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      const previousPage = index > 0 ? forwardPulls[index - 1] : null;
      if (previousPage?.nextCursor) {
        expect(page.requestCursor).toEqual(previousPage.nextCursor);
      }
    }

    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'mobile-2',
        opType: 'acl_add',
        itemId: 'item-replay-concurrent-c'
      })
    );
    expect(forwardItems).toContainEqual(
      expect.objectContaining({
        opId: 'tablet-2',
        opType: 'link_remove',
        itemId: 'item-replay-concurrent-b'
      })
    );
    expect(forwardItems.map((item) => item.opId)).not.toContain(
      seedReplayCursor.changeId
    );

    for (const item of forwardItems) {
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
  });

  it('keeps replay cursor monotonic across sequential post-restart sync cycles', async () => {
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
      { pullLimit: 1 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      { pullLimit: 1 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:33:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const persistedDesktopState = desktop.exportState();
    const seedReplayCursor = readReplaySnapshotCursorOrThrow({
      state: persistedDesktopState,
      errorMessage: 'expected replay seed cursor before restart cycles'
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
      itemId: 'item-cycle-a',
      parentId: 'root',
      childId: 'item-cycle-a',
      occurredAt: '2026-02-14T14:33:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:33:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleOnePulls = observedPulls.slice(cycleOneStart);
    expect(cycleOnePulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleOnePulls[0]?.requestCursor).toEqual(seedReplayCursor);
    expect(cycleOnePulls[cycleOnePulls.length - 1]?.hasMore).toBe(false);

    const cycleOneItems = cycleOnePulls.flatMap((page) => page.items);
    for (const item of cycleOneItems) {
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

    const cycleOneTerminalCursor =
      cycleOnePulls[cycleOnePulls.length - 1]?.nextCursor;
    expect(cycleOneTerminalCursor).not.toBeNull();
    if (!cycleOneTerminalCursor) {
      throw new Error('expected cycle one terminal cursor');
    }

    const cycleTwoStart = observedPulls.length;

    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-cycle-a',
      parentId: 'root',
      childId: 'item-cycle-a',
      occurredAt: '2026-02-14T14:33:03.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-cycle-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:33:04.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const cycleTwoPulls = observedPulls.slice(cycleTwoStart);
    expect(cycleTwoPulls.length).toBeGreaterThanOrEqual(2);
    expect(cycleTwoPulls[0]?.requestCursor).toEqual(cycleOneTerminalCursor);
    expect(cycleTwoPulls[cycleTwoPulls.length - 1]?.hasMore).toBe(false);

    const cycleTwoItems = cycleTwoPulls.flatMap((page) => page.items);
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
});
