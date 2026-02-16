import { describe, expect, it } from 'vitest';
import { InMemoryVfsCrdtSyncServer, VfsBackgroundSyncClient } from './index.js';
import { encodeVfsSyncCursor } from './sync-cursor.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport integration guardrails', () => {
  it('fails closed when reconcile acknowledgement regresses cursor frontier', async () => {
    let desktopReconcileCalls = 0;
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'link_add',
          itemId: 'item-race',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T23:30:00.000Z',
          parentId: 'root',
          childId: 'item-race'
        }
      ]
    });

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload, context) => {
        if (context.body.clientId !== 'desktop') {
          return payload;
        }

        desktopReconcileCalls += 1;
        if (desktopReconcileCalls < 2) {
          return payload;
        }

        return {
          ...payload,
          cursor: encodeVfsSyncCursor({
            changedAt: '2026-02-14T23:29:59.000Z',
            changeId: 'desktop-stale'
          })
        };
      }
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 1 }
    );

    await client.sync();
    const snapshotBeforeRegression = client.snapshot();
    expect(snapshotBeforeRegression.cursor).toEqual({
      changedAt: '2026-02-14T23:30:00.000Z',
      changeId: 'remote-1'
    });

    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );
    expect(client.snapshot()).toEqual(snapshotBeforeRegression);
  });

  it('fails closed when reconcile acknowledgement regresses write-id frontier', async () => {
    let desktopReconcileCalls = 0;
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'link_add',
          itemId: 'item-write-id',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T23:31:00.000Z',
          parentId: 'root',
          childId: 'item-write-id'
        },
        {
          opId: 'remote-2',
          opType: 'link_remove',
          itemId: 'item-write-id',
          replicaId: 'remote',
          writeId: 2,
          occurredAt: '2026-02-14T23:31:01.000Z',
          parentId: 'root',
          childId: 'item-write-id'
        }
      ]
    });

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutateReconcilePayload: (payload, context) => {
        if (context.body.clientId !== 'desktop') {
          return payload;
        }

        desktopReconcileCalls += 1;
        if (desktopReconcileCalls < 2) {
          return payload;
        }

        return {
          ...payload,
          lastReconciledWriteIds: {
            ...payload.lastReconciledWriteIds,
            remote: 1
          }
        };
      }
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      { pullLimit: 1 }
    );

    await client.sync();
    const snapshotBeforeRegression = client.snapshot();
    expect(snapshotBeforeRegression.lastReconciledWriteIds).toEqual({
      remote: 2
    });

    await expect(client.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(client.snapshot()).toEqual(snapshotBeforeRegression);
  });

  it('fails closed when sync replay payload drifts to malformed link rows', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'link_add',
          itemId: 'item-9',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T22:10:00.000Z',
          parentId: 'root',
          childId: 'item-9'
        }
      ]
    });

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      mutatePullPayload: (payload) => ({
        ...payload,
        items: payload.items.map((item) =>
          item.opType === 'link_add' || item.opType === 'link_remove'
            ? {
                ...item,
                childId: 'item-mismatch'
              }
            : item
        )
      })
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      })
    );

    await expect(client.sync()).rejects.toThrowError(/invalid link payload/);
    expect(client.snapshot()).toEqual({
      acl: [],
      links: [],
      pendingOperations: 0,
      cursor: null,
      lastReconciledWriteIds: {},
      containerClocks: [],
      nextLocalWriteId: 1
    });
  });
});
