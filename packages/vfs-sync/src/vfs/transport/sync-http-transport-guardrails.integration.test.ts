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
    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload) => {
        return {
          ...payload,
          cur: encodeVfsSyncCursor({
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

    const client = new VfsBackgroundSyncClient({
      userId: 'user-1',
      clientId: 'mobile',
      transport
    });

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
      delays: {},
      mutateReconcilePayload: (payload) => {
        return {
          ...payload,
          w: {
            desktop: 1 // Regressed from 10
          }
        };
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient({
      userId: 'user-1',
      clientId: 'mobile',
      transport
    });

    const baseline = captureExportedSyncClientState(client);

    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );

    expectExportedSyncClientStateUnchanged({ client, before: baseline });
  });

  it('fails closed when sync replay payload drifts to malformed link rows', async () => {
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
        const item = payload.i[0];
        if (item) {
          // Field 10 is childId, 2 is itemId. Force mismatch.
          item[10] = 'mismatched-child';
        }
        return payload;
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient({
      userId: 'user-1',
      clientId: 'mobile',
      transport
    });

    await expect(client.sync()).rejects.toThrowError(/invalid link payload/);
    expect(client.snapshot()).toEqual({
      acl: [],
      links: []
    });
  });
});
