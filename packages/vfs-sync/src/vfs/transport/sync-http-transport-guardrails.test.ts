import { describe, expect, it, vi } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport guardrails', () => {
  it('throws with server-provided error details for non-2xx responses', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'bad payload' }), { status: 400 })
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: []
      })
    ).rejects.toThrowError(/bad payload/);
  });

  it('fails closed when push response shape is invalid', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            clientId: 'desktop',
            results: [{ opId: 'desktop-1', status: 'unknown' }]
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: []
      })
    ).rejects.toThrowError(/invalid results\[0\]\.status/);
  });

  it('fails closed when reconcile response references another client', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            clientId: 'mobile',
            cursor: encodeVfsSyncCursor({
              changedAt: '2026-02-14T20:10:05.000Z',
              changeId: 'mobile-1'
            }),
            lastReconciledWriteIds: {
              mobile: 1
            }
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.reconcileState({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: {
          changedAt: '2026-02-14T20:10:04.000Z',
          changeId: 'desktop-4'
        },
        lastReconciledWriteIds: {
          desktop: 4
        }
      })
    ).rejects.toThrowError(/mismatched clientId/);
  });

  it('fails closed when pull response cursor is malformed', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [],
            nextCursor: 'not-a-valid-cursor',
            hasMore: false,
            lastReconciledWriteIds: {}
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/invalid nextCursor/);
  });

  it('fails closed when pull response has invalid replica write ids', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [],
            nextCursor: null,
            hasMore: false,
            lastReconciledWriteIds: {
              desktop: 0
            }
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/positive integer/);
  });

  it('fails closed when pull response contains link itemId/childId mismatch', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                opId: 'desktop-link-2',
                itemId: 'item-1',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'parent-1',
                childId: 'item-2',
                actorId: 'user-1',
                sourceTable: 'vfs_crdt_client_push',
                sourceId: 'user-1:desktop:2:desktop-link-2',
                occurredAt: '2026-02-14T20:10:02.000Z'
              }
            ],
            nextCursor: null,
            hasMore: false,
            lastReconciledWriteIds: {}
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/invalid link payload/);
  });

  it('fails closed when pull response contains self-referential link item', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                opId: 'desktop-link-3',
                itemId: 'item-1',
                opType: 'link_add',
                principalType: null,
                principalId: null,
                accessLevel: null,
                parentId: 'item-1',
                childId: 'item-1',
                actorId: 'user-1',
                sourceTable: 'vfs_crdt_client_push',
                sourceId: 'user-1:desktop:3:desktop-link-3',
                occurredAt: '2026-02-14T20:10:03.000Z'
              }
            ],
            nextCursor: null,
            hasMore: false,
            lastReconciledWriteIds: {}
          }),
          { status: 200 }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/invalid link payload/);
  });
});
