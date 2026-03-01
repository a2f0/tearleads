import { describe, expect, it } from 'vitest';
import {
  captureExportedSyncClientState,
  expectExportedSyncClientStateUnchanged
} from '../client/sync-client-test-support-observers.js';
import {
  InMemoryVfsCrdtSyncServer,
  VfsBackgroundSyncClient,
  VfsHttpCrdtSyncTransport
} from '../index.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';

describe('VfsHttpCrdtSyncTransport integration guardrails', () => {
  it('fails closed when reconcile acknowledgement regresses cursor frontier', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'seed-cursor',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T20:00:00.000Z',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'admin'
        }
      ]
    });

    const healthyFetch = createServerBackedFetch(server, {
      delays: {}
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'http://api.local',
        fetchImpl: healthyFetch
      })
    );
    await seedClient.sync();
    const persistedState = seedClient.exportState();

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload) => {
        return {
          ...payload,
          cursor: encodeVfsSyncCursor({
            changedAt: '2000-01-01T00:00:00.000Z',
            changeId: 'regressed-op'
          })
        };
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient('user-1', 'mobile', transport);
    client.hydrateState(persistedState);

    const baseline = captureExportedSyncClientState(client);

    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );

    expectExportedSyncClientStateUnchanged({ client, before: baseline });
  });

  it('fails closed when reconcile acknowledgement regresses write-id frontier', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    // Pre-seed an op so client can advance its frontier
    await server.pushOperations({
      operations: [
        {
          opId: 'seed-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 10,
          occurredAt: '2026-02-14T20:00:00.000Z',
          principalType: 'user',
          principalId: 'user-1',
          accessLevel: 'admin'
        }
      ]
    });

    const fetchImpl = createServerBackedFetch(server, {
      delays: {}
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'http://api.local',
        fetchImpl
      })
    );
    await seedClient.sync();
    const persistedState = seedClient.exportState();

    const regressedFetch = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload) => {
        return {
          ...payload,
          lastReconciledWriteIds: {
            desktop: 1 // Regressed from 10
          }
        };
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl: regressedFetch
    });

    const client = new VfsBackgroundSyncClient('user-1', 'mobile', transport);
    client.hydrateState(persistedState);

    const baseline = captureExportedSyncClientState(client);

    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );

    expectExportedSyncClientStateUnchanged({ client, before: baseline });
  });

  it('fails closed when pull payload cursor drifts from page tail', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'op-1',
          opType: 'link_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T20:00:00.000Z',
          parentId: 'folder-1',
          childId: 'item-1'
        }
      ]
    });

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutatePullPayload: (payload) => {
        return {
          ...payload,
          nextCursor: encodeVfsSyncCursor({
            changedAt: '1999-01-01T00:00:00.000Z',
            changeId: 'cursor-regression'
          })
        };
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient('user-1', 'mobile', transport);

    await expect(client.sync()).rejects.toThrowError(
      /nextCursor that does not match pull page tail/
    );
    expect(client.snapshot().acl).toEqual([]);
    expect(client.snapshot().links).toEqual([]);
  });
});
