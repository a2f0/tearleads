import { describe, expect, it, vi } from 'vitest';
import type { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport', () => {
  it('pushes operations to the CRDT push endpoint with auth headers', async () => {
    const fetchMock = vi.fn(
      async () => {
        return new Response(JSON.stringify({
          r: [
            {
              opId: 'desktop-1',
              status: 'applied'
            }
          ]
        }), { status: 200 });
      }
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      getAuthToken: () => 'token-1'
    });

    const result = await transport.pushOperations({
      userId: 'user-1',
      clientId: 'desktop',
      operations: [
        {
          opId: 'desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T20:00:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    expect(result).toEqual({
      results: [
        {
          opId: 'desktop-1',
          status: 'applied'
        }
      ]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBe('https://sync.example.com/v1/vfs/crdt/push');

    const requestInit = firstCall?.[1];
    const body = JSON.parse(requestInit?.body as string);
    expect(body.c).toBe('desktop');
    expect(Array.isArray(body.o[0])).toBe(true); 
    expect(body.o[0][0]).toBe('desktop-1'); 
  });

  it('pulls operations, decodes cursor, and includes replica write ids', async () => {
    const cursor = {
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    };
    const nextCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:01.000Z',
      changeId: 'desktop-2'
    });

    const fetchMock = vi.fn(
      async () => {
        return new Response(JSON.stringify({
          i: [
            [
              'desktop-2',
              'acl_add',
              'item-1',
              'desktop',
              2,
              '2026-02-14T20:10:01.000Z',
              'group-1',
              'group',
              'write',
              null,
              null,
              'user-1',
              'vfs_crdt_client_push',
              'user-1:desktop:2:desktop-2',
              null
            ]
          ],
          n: nextCursor,
          m: true,
          w: {
            desktop: 2,
            mobile: 5
          }
        }), { status: 200 });
      }
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    const result = await transport.pullOperations({
      userId: 'user-1',
      clientId: 'desktop',
      cursor,
      limit: 25
    });

    expect(result).toEqual({
      items: [
        {
          opId: 'desktop-2',
          itemId: 'item-1',
          opType: 'acl_add',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'write',
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'user-1:desktop:2:desktop-2',
          occurredAt: '2026-02-14T20:10:01.000Z',
          replicaId: 'desktop',
          writeId: 2,
          encryptedPayload: null
        }
      ],
      hasMore: true,
      nextCursor: {
        changedAt: '2026-02-14T20:10:01.000Z',
        changeId: 'desktop-2'
      },
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 5
      }
    });
  });

  it('reconciles cursor/write ids through the CRDT reconcile endpoint', async () => {
    const fetchMock = vi.fn(
      async () => {
        return new Response(JSON.stringify({
          c: 'desktop',
          cur: encodeVfsSyncCursor({
            changedAt: '2026-02-14T20:10:05.000Z',
            changeId: 'desktop-5'
          }),
          w: {
            desktop: 5,
            mobile: 3
          }
        }), { status: 200 });
      }
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    const result = await transport.reconcileState({
      userId: 'user-1',
      clientId: 'desktop',
      cursor: {
        changedAt: '2026-02-14T20:10:04.000Z',
        changeId: 'desktop-4'
      },
      lastReconciledWriteIds: {
        desktop: 4
      }
    });

    expect(result).toEqual({
      cursor: {
        changedAt: '2026-02-14T20:10:05.000Z',
        changeId: 'desktop-5'
      },
      lastReconciledWriteIds: {
        desktop: 5,
        mobile: 3
      }
    });
  });

  it('throws typed rematerialization error for 409 stale-cursor responses', async () => {
    const requestedCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: 'op-10'
    });
    const oldestAvailableCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-100'
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error:
              'CRDT cursor is older than retained history; re-materialization required',
            code: 'crdt_rematerialization_required',
            requestedCursor,
            oldestAvailableCursor
          }),
          { status: 409 }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: {
          changedAt: '2026-02-10T00:00:00.000Z',
          changeId: 'op-10'
        },
        limit: 50
      })
    ).rejects.toEqual(
      expect.objectContaining<VfsCrdtRematerializationRequiredError>({
        name: 'VfsCrdtRematerializationRequiredError',
        code: 'crdt_rematerialization_required',
        requestedCursor,
        oldestAvailableCursor
      })
    );
  });
});
