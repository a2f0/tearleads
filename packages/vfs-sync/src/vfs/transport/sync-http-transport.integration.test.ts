import { describe, expect, it } from 'vitest';
import {
  captureExportedSyncClientState,
  expectExportedSyncClientStateUnchanged
} from '../client/sync-client-test-support-observers.js';
import {
  InMemoryVfsCrdtSyncServer,
  VfsBackgroundSyncClient
} from '../index.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

const TEST_ORGANIZATION_ID = 'org-1';
const REMOTE_SEED_OP_ID = '00000000-0000-0000-0000-000000000901';
type HttpFetchImpl = ReturnType<typeof createServerBackedFetch>;
type SyncServerSnapshot = ReturnType<InMemoryVfsCrdtSyncServer['snapshot']>;

function createTestOpId(sequence: number): string {
  return `00000000-0000-0000-0000-${sequence.toString().padStart(12, '0')}`;
}

function createClient(input: {
  fetchImpl: HttpFetchImpl;
  clientId: string;
  pullLimit: number;
}): VfsBackgroundSyncClient {
  return new VfsBackgroundSyncClient(
    'user-1',
    input.clientId,
    new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.local',
      fetchImpl: input.fetchImpl,
      organizationId: TEST_ORGANIZATION_ID
    }),
    { pullLimit: input.pullLimit }
  );
}

function expectClientToMatchServer(
  client: VfsBackgroundSyncClient,
  serverSnapshot: SyncServerSnapshot
): void {
  const snapshot = client.snapshot();
  expect(snapshot.pendingOperations).toBe(0);
  expect(snapshot.acl).toEqual(serverSnapshot.acl);
  expect(snapshot.links).toEqual(serverSnapshot.links);
  expect(snapshot.lastReconciledWriteIds).toEqual(
    serverSnapshot.lastReconciledWriteIds
  );
}

describe('VfsHttpCrdtSyncTransport integration', () => {
  it('syncs link_reassign operations across HTTP transport', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const fetchImpl = createServerBackedFetch(server, { delays: {} });

    const desktop = createClient({
      fetchImpl,
      clientId: 'desktop',
      pullLimit: 2
    });
    const mobile = createClient({
      fetchImpl,
      clientId: 'mobile',
      pullLimit: 2
    });

    desktop.queueLocalOperation({
      opId: createTestOpId(1),
      opType: 'link_add',
      itemId: 'reading-1',
      parentId: 'contact-1',
      childId: 'reading-1',
      occurredAt: '2026-02-14T21:59:59.000Z'
    });
    await desktop.flush();
    await Promise.all([desktop.sync(), mobile.sync()]);

    desktop.queueLocalOperation({
      opId: createTestOpId(2),
      opType: 'link_reassign',
      itemId: 'reading-1',
      parentId: 'contact-2',
      childId: 'reading-1',
      occurredAt: '2026-02-14T22:00:00.000Z'
    });

    await desktop.flush();
    await Promise.all([desktop.sync(), mobile.sync()]);

    const serverSnapshot = server.snapshot();

    expect(serverSnapshot.links).toEqual([
      {
        parentId: 'contact-2',
        childId: 'reading-1'
      }
    ]);
    expectClientToMatchServer(desktop, serverSnapshot);
    expectClientToMatchServer(mobile, serverSnapshot);
  });

  it('converges concurrent clients through HTTP transport', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const fetchImpl = createServerBackedFetch(server, {
      delays: {
        desktopPushDelayMs: 20,
        mobilePushDelayMs: 5,
        pullDelayMs: 10
      }
    });

    const desktop = createClient({
      fetchImpl,
      clientId: 'desktop',
      pullLimit: 2
    });
    const mobile = createClient({
      fetchImpl,
      clientId: 'mobile',
      pullLimit: 1
    });

    desktop.queueLocalOperation({
      opId: createTestOpId(3),
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T22:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opId: createTestOpId(4),
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:02.000Z'
    });
    mobile.queueLocalOperation({
      opId: createTestOpId(5),
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T22:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opId: createTestOpId(6),
      opType: 'link_remove',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:03.000Z'
    });
    mobile.queueLocalOperation({
      opId: createTestOpId(7),
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T22:00:04.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush()]);
    await Promise.all([desktop.sync(), mobile.sync()]);

    const serverSnapshot = server.snapshot();

    expectClientToMatchServer(desktop, serverSnapshot);
    expectClientToMatchServer(mobile, serverSnapshot);
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

    const desktop = createClient({
      fetchImpl,
      clientId: 'desktop',
      pullLimit: 2
    });
    const mobile = createClient({
      fetchImpl,
      clientId: 'mobile',
      pullLimit: 1
    });
    const tablet = createClient({
      fetchImpl,
      clientId: 'tablet',
      pullLimit: 3
    });

    desktop.queueLocalOperation({
      opId: createTestOpId(8),
      opType: 'link_add',
      itemId: 'folder-22',
      parentId: 'root',
      childId: 'folder-22',
      occurredAt: '2026-02-14T23:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opId: createTestOpId(9),
      opType: 'link_add',
      itemId: 'item-old',
      parentId: 'folder-22',
      childId: 'item-old',
      occurredAt: '2026-02-14T23:00:01.000Z'
    });

    mobile.queueLocalOperation({
      opId: createTestOpId(10),
      opType: 'link_remove',
      itemId: 'folder-22',
      parentId: 'root',
      childId: 'folder-22',
      occurredAt: '2026-02-14T23:00:02.000Z'
    });
    mobile.queueLocalOperation({
      opId: createTestOpId(11),
      opType: 'link_remove',
      itemId: 'item-old',
      parentId: 'folder-22',
      childId: 'item-old',
      occurredAt: '2026-02-14T23:00:04.000Z'
    });
    mobile.queueLocalOperation({
      opId: createTestOpId(12),
      opType: 'link_remove',
      itemId: 'item-new',
      parentId: 'folder-22',
      childId: 'item-new',
      occurredAt: '2026-02-14T23:00:05.000Z'
    });

    tablet.queueLocalOperation({
      opId: createTestOpId(13),
      opType: 'link_add',
      itemId: 'item-new',
      parentId: 'folder-22',
      childId: 'item-new',
      occurredAt: '2026-02-14T23:00:03.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush(), tablet.flush()]);
    await Promise.all([desktop.sync(), mobile.sync(), tablet.sync()]);

    const observer = createClient({
      fetchImpl,
      clientId: 'observer',
      pullLimit: 1
    });

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

    expect(serverSnapshot.acl).toEqual([]);
    expect(serverSnapshot.links).toEqual([]);
    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 3,
      tablet: 1
    });
    expectClientToMatchServer(desktop, serverSnapshot);
    expectClientToMatchServer(mobile, serverSnapshot);
    expectClientToMatchServer(tablet, serverSnapshot);
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
          opId: REMOTE_SEED_OP_ID,
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
    const seedClient = createClient({
      fetchImpl: healthyFetch,
      clientId: 'desktop',
      pullLimit: 1
    });

    await seedClient.sync();
    seedClient.queueLocalOperation({
      opId: createTestOpId(14),
      opType: 'link_add',
      itemId: 'item-hydrate',
      parentId: 'root',
      childId: 'item-hydrate',
      occurredAt: '2026-02-16T00:00:01.000Z'
    });
    seedClient.queueLocalOperation({
      opId: createTestOpId(15),
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
    const failedResumeClient = createClient({
      fetchImpl: malformedPullFetch,
      clientId: 'desktop',
      pullLimit: 1
    });
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

    const resumedClient = createClient({
      fetchImpl: healthyFetch,
      clientId: 'desktop',
      pullLimit: 1
    });
    resumedClient.hydrateState(persisted);

    await resumedClient.flush();
    await resumedClient.flush();
    await resumedClient.sync();

    const serverSnapshot = server.snapshot();
    expectClientToMatchServer(resumedClient, serverSnapshot);
    expect(resumedClient.snapshot().cursor).not.toBeNull();
  });

  it('preserves reconcile checkpoint handoff across hydrate restart with queued locals', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: REMOTE_SEED_OP_ID,
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

    const seedClient = createClient({
      fetchImpl: healthyFetch,
      clientId: 'desktop',
      pullLimit: 1
    });

    await seedClient.sync();
    seedClient.queueLocalOperation({
      opId: createTestOpId(16),
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
    const failedResumeClient = createClient({
      fetchImpl: malformedPullFetch,
      clientId: 'desktop',
      pullLimit: 1
    });
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

    const resumedClient = createClient({
      fetchImpl: healthyFetch,
      clientId: 'desktop',
      pullLimit: 1
    });
    resumedClient.hydrateState(persistedState);

    await resumedClient.flush();
    await resumedClient.sync();
    await resumedClient.flush();
    await resumedClient.sync();

    const serverSnapshot = server.snapshot();
    expectClientToMatchServer(resumedClient, serverSnapshot);
    expect(observedReconcileInputs.length).toBeGreaterThan(0);
    expect(observedReconcileInputs.at(-1)?.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
  });
});
