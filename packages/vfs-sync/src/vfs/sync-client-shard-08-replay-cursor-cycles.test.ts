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
