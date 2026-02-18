import { describe, expect, it } from 'vitest';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readSeedContainerCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
