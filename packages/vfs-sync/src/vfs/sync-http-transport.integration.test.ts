import { describe, expect, it } from 'vitest';
import { InMemoryVfsCrdtSyncServer, VfsBackgroundSyncClient } from './index.js';
import {
  captureExportedSyncClientState,
  expectExportedSyncClientStateUnchanged
} from './sync-client-test-support-observers.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport integration', () => {
  it('converges concurrent clients through HTTP transport', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const fetchImpl = createServerBackedFetch(server, {
      delays: {
        desktopPushDelayMs: 20,
        mobilePushDelayMs: 5,
        pullDelayMs: 10
      }
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 2 }
    );

    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 1 }
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T22:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T22:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:03.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:04.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush()]);
    await Promise.all([desktop.sync(), mobile.sync()]);

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
  });

  it('preserves branch-delete races across paged sync and reconcile acknowledgements', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const fetchImpl = createServerBackedFetch(server, {
      delays: {
        desktopPushDelayMs: 20,
        mobilePushDelayMs: 10,
        tabletPushDelayMs: 5,
        pullDelayMs: 8
      }
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 2 }
    );

    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 1 }
    );

    const tablet = new VfsBackgroundSyncClient(
      'user-1',
      'tablet',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 3 }
    );

    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'folder-22',
      parentId: 'root',
      childId: 'folder-22',
      occurredAt: '2026-02-14T23:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-old',
      parentId: 'folder-22',
      childId: 'item-old',
      occurredAt: '2026-02-14T23:00:01.000Z'
    });

    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'folder-22',
      parentId: 'root',
      childId: 'folder-22',
      occurredAt: '2026-02-14T23:00:02.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-old',
      parentId: 'folder-22',
      childId: 'item-old',
      occurredAt: '2026-02-14T23:00:04.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_remove',
      itemId: 'item-new',
      parentId: 'folder-22',
      childId: 'item-new',
      occurredAt: '2026-02-14T23:00:05.000Z'
    });

    tablet.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-new',
      parentId: 'folder-22',
      childId: 'item-new',
      occurredAt: '2026-02-14T23:00:03.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush(), tablet.flush()]);
    await Promise.all([desktop.sync(), mobile.sync(), tablet.sync()]);

    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 1 }
    );

    await observer.sync();
    const observerAfterFirstSync = observer.snapshot();

    /**
     * Guardrail: once the observer stores reconcile cursor + replica write IDs,
     * a second sync with no new writes must be a no-op and must not resurrect
     * edges from detached intermediate branch states.
     */
    await observer.sync();
    const observerAfterSecondSync = observer.snapshot();

    const serverSnapshot = server.snapshot();
    const desktopSnapshot = desktop.snapshot();
    const mobileSnapshot = mobile.snapshot();
    const tabletSnapshot = tablet.snapshot();

    expect(serverSnapshot.acl).toEqual([]);
    expect(serverSnapshot.links).toEqual([]);
    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 3,
      tablet: 1
    });
    expect(desktopSnapshot.pendingOperations).toBe(0);
    expect(mobileSnapshot.pendingOperations).toBe(0);
    expect(tabletSnapshot.pendingOperations).toBe(0);
    expect(desktopSnapshot.links).toEqual(serverSnapshot.links);
    expect(mobileSnapshot.links).toEqual(serverSnapshot.links);
    expect(tabletSnapshot.links).toEqual(serverSnapshot.links);
    expect(desktopSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(mobileSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(tabletSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(observerAfterFirstSync).toEqual(observerAfterSecondSync);
    expect(observerAfterSecondSync.links).toEqual(serverSnapshot.links);
    expect(observerAfterSecondSync.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
  });

  it('resumes from hydrated pending queue after fail-closed sync and converges on retry', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const healthyFetch = createServerBackedFetch(server, { delays: {} });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: healthyFetch
      }),
      { pullLimit: 1 }
    );

    await seedClient.sync();
    seedClient.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-hydrate',
      parentId: 'root',
      childId: 'item-hydrate',
      occurredAt: '2026-02-16T00:00:01.000Z'
    });
    seedClient.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-hydrate',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-16T00:00:02.000Z'
    });

    const persisted = seedClient.exportState();

    const malformedPullFetch = createServerBackedFetch(server, {
      delays: {},
      mutatePullPayload: (payload) => ({
        ...payload,
        items: [],
        hasMore: true,
        nextCursor: null
      })
    });
    const failedResumeClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: malformedPullFetch
      }),
      { pullLimit: 1 }
    );
    failedResumeClient.hydrateState(persisted);
    const preFailureExportState =
      captureExportedSyncClientState(failedResumeClient);

    await expect(failedResumeClient.sync()).rejects.toThrowError(
      /hasMore=true with an empty pull page/
    );
    expectExportedSyncClientStateUnchanged({
      client: failedResumeClient,
      before: preFailureExportState
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: healthyFetch
      }),
      { pullLimit: 1 }
    );
    resumedClient.hydrateState(persisted);

    await resumedClient.flush();
    await resumedClient.flush();
    await resumedClient.sync();

    const serverSnapshot = server.snapshot();
    const resumedSnapshot = resumedClient.snapshot();
    expect(resumedSnapshot.pendingOperations).toBe(0);
    expect(resumedSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(resumedSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(resumedSnapshot.cursor).not.toBeNull();
  });

  it('preserves reconcile checkpoint handoff across hydrate restart with queued locals', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-checkpoint',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-16T01:00:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const observedReconcileInputs: Array<{
      cursor: string;
      lastReconciledWriteIds: Record<string, number>;
    }> = [];

    const healthyFetch = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload, context) => {
        observedReconcileInputs.push({
          cursor: context.body.cursor.changeId,
          lastReconciledWriteIds: { ...context.body.lastReconciledWriteIds }
        });
        return payload;
      }
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: healthyFetch
      }),
      { pullLimit: 1 }
    );

    await seedClient.sync();
    seedClient.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-checkpoint',
      parentId: 'root',
      childId: 'item-checkpoint',
      occurredAt: '2026-02-16T01:00:01.000Z'
    });

    const persistedState = seedClient.exportState();

    const malformedPullFetch = createServerBackedFetch(server, {
      delays: {},
      mutatePullPayload: (payload) => ({
        ...payload,
        items: [],
        hasMore: true,
        nextCursor: null
      })
    });
    const failedResumeClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: malformedPullFetch
      }),
      { pullLimit: 1 }
    );
    failedResumeClient.hydrateState(persistedState);
    const preFailureExportState =
      captureExportedSyncClientState(failedResumeClient);

    await expect(failedResumeClient.sync()).rejects.toThrowError(
      /hasMore=true with an empty pull page/
    );
    expectExportedSyncClientStateUnchanged({
      client: failedResumeClient,
      before: preFailureExportState
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl: healthyFetch
      }),
      { pullLimit: 1 }
    );
    resumedClient.hydrateState(persistedState);

    await resumedClient.flush();
    await resumedClient.sync();
    await resumedClient.flush();
    await resumedClient.sync();

    const resumedSnapshot = resumedClient.snapshot();
    const serverSnapshot = server.snapshot();

    expect(resumedSnapshot.pendingOperations).toBe(0);
    expect(resumedSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(resumedSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(observedReconcileInputs.length).toBeGreaterThan(0);
    expect(observedReconcileInputs.at(-1)?.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
  });
});
