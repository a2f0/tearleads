import { describe, expect, it } from 'vitest';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readSeedContainerCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('transitions pre-restart cursor from stable-empty to strict-forward after new writes', async () => {
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
      itemId: 'item-hybrid-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:28:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hybrid-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:28:01.000Z'
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

    const emptyPageAfterHydrate = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(emptyPageAfterHydrate).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hybrid-c',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:28:02.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPageAfterWrite = resumedDesktop.listChangedContainers(
      seedCursor,
      10
    );
    expect(forwardPageAfterWrite.items.length).toBeGreaterThan(0);
    expect(forwardPageAfterWrite.items).toContainEqual({
      containerId: 'item-hybrid-c',
      changedAt: '2026-02-14T14:28:02.000Z',
      changeId: 'mobile-3'
    });

    for (const item of forwardPageAfterWrite.items) {
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

  it('transitions link-driven parent container cursor from stable-empty to strict-forward after restart', async () => {
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
      opType: 'link_add',
      itemId: 'item-link-a',
      parentId: 'root',
      childId: 'item-link-a',
      occurredAt: '2026-02-14T14:29:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const rootSeedPage = desktop.listChangedContainers(null, 10);
    const rootSeedEntry = rootSeedPage.items.find(
      (entry) => entry.containerId === 'root'
    );
    if (!rootSeedEntry) {
      throw new Error('expected root container clock seed entry');
    }
    const rootSeedCursor = {
      changedAt: rootSeedEntry.changedAt,
      changeId: rootSeedEntry.changeId
    };

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const emptyRootPage = resumedDesktop.listChangedContainers(
      rootSeedCursor,
      10
    );
    expect(emptyRootPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-link-a',
      parentId: 'root',
      childId: 'item-link-a',
      occurredAt: '2026-02-14T14:29:01.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardRootPage = resumedDesktop.listChangedContainers(
      rootSeedCursor,
      10
    );
    expect(forwardRootPage.items.length).toBeGreaterThan(0);
    expect(forwardRootPage.items).toContainEqual({
      containerId: 'root',
      changedAt: '2026-02-14T14:29:01.000Z',
      changeId: 'mobile-2'
    });

    for (const item of forwardRootPage.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          rootSeedCursor
        )
      ).toBeGreaterThan(0);
    }
  });

  it('reused mixed acl+link cursor excludes boundary rows and returns strict-forward updates', async () => {
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
      itemId: 'item-mix-a',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:30:00.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-mix-link',
      parentId: 'root',
      childId: 'item-mix-link',
      occurredAt: '2026-02-14T14:30:01.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    const seedCursor = readSeedContainerCursorOrThrow({
      client: desktop,
      pageLimit: 10,
      errorMessage: 'expected mixed pre-restart seed cursor'
    });

    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(desktop.exportState());

    const emptyPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    expect(emptyPage).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null
    });

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-mix-b',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T14:30:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-mix-link',
      parentId: 'root',
      childId: 'item-mix-link',
      occurredAt: '2026-02-14T14:30:03.000Z'
    });
    await mobile.flush();
    await resumedDesktop.sync();

    const forwardPage = resumedDesktop.listChangedContainers(seedCursor, 10);
    expect(forwardPage.items).toContainEqual({
      containerId: 'item-mix-b',
      changedAt: '2026-02-14T14:30:02.000Z',
      changeId: 'mobile-3'
    });
    expect(forwardPage.items).toContainEqual({
      containerId: 'root',
      changedAt: '2026-02-14T14:30:03.000Z',
      changeId: 'mobile-4'
    });

    for (const item of forwardPage.items) {
      expect(
        compareVfsSyncCursorOrder(
          {
            changedAt: item.changedAt,
            changeId: item.changeId
          },
          seedCursor
        )
      ).toBeGreaterThan(0);
      expect(item.changeId).not.toBe(seedCursor.changeId);
    }
  });
});
