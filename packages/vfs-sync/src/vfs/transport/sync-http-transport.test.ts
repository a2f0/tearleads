import { describe, expect, it, vi } from 'vitest';
import type { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  decodeVfsCrdtPushRequestProtobuf,
  decodeVfsCrdtSyncSessionRequestProtobuf,
  encodeVfsCrdtPushResponseProtobuf,
  encodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsCrdtSyncResponseProtobuf,
  encodeVfsCrdtSyncSessionResponseProtobuf
} from '../protocol/syncProtobuf.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
          return;
        }
        reject(new Error('expected blob reader result to be array buffer'));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('failed to read blob request body'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  throw new Error('expected blob request body to expose readable bytes');
}

async function readRequestBodyBytes(
  body: BodyInit | null | undefined
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (body instanceof Blob) {
    return readBlobBytes(body);
  }
  if (body && ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body === null || body === undefined) {
    throw new Error('expected request body to be protobuf bytes');
  }

  const buffer = await new Response(body).arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error('expected request body to be protobuf bytes');
  }
  return new Uint8Array(buffer);
}

describe('VfsHttpCrdtSyncTransport', () => {
  it('pushes operations to the CRDT push endpoint with auth headers', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        encodeVfsCrdtPushResponseProtobuf({
          clientId: 'desktop',
          results: [
            {
              opId: 'desktop-1',
              status: 'applied'
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        }
      );
    });

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
    const requestBytes = await readRequestBodyBytes(requestInit?.body);
    const decodedBody = decodeVfsCrdtPushRequestProtobuf(requestBytes);
    if (
      typeof decodedBody !== 'object' ||
      decodedBody === null ||
      !('clientId' in decodedBody) ||
      !('operations' in decodedBody)
    ) {
      throw new Error('expected push request protobuf payload');
    }
    expect(decodedBody.clientId).toBe('desktop');
    if (!Array.isArray(decodedBody.operations)) {
      throw new Error('expected push request operations array');
    }
    expect(decodedBody.operations[0]).toEqual(
      expect.objectContaining({ opId: 'desktop-1' })
    );
    expect(new Headers(requestInit?.headers).get('Accept')).toBe(
      'application/x-protobuf'
    );
    expect(new Headers(requestInit?.headers).get('Content-Type')).toBe(
      'application/x-protobuf'
    );
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

    const fetchMock = vi.fn(async () => {
      return new Response(
        encodeVfsCrdtSyncResponseProtobuf({
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
              occurredAt: '2026-02-14T20:10:01.000Z'
            }
          ],
          nextCursor,
          hasMore: true,
          lastReconciledWriteIds: {
            desktop: 2,
            mobile: 5
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        }
      );
    });

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
          occurredAt: '2026-02-14T20:10:01.000Z'
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
    const fetchMock = vi.fn(async () => {
      return new Response(
        encodeVfsCrdtReconcileResponseProtobuf({
          clientId: 'desktop',
          cursor: encodeVfsSyncCursor({
            changedAt: '2026-02-14T20:10:05.000Z',
            changeId: 'desktop-5'
          }),
          lastReconciledWriteIds: {
            desktop: 5,
            mobile: 3
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        }
      );
    });

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

  it('runs unified sync session over protobuf and parses nested results', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          encodeVfsCrdtSyncSessionResponseProtobuf({
            push: {
              clientId: 'desktop',
              results: [{ opId: 'desktop-6', status: 'applied' }]
            },
            pull: {
              items: [
                {
                  opId: 'desktop-7',
                  itemId: 'item-1',
                  opType: 'acl_add',
                  principalType: 'group',
                  principalId: 'group-1',
                  accessLevel: 'read',
                  parentId: null,
                  childId: null,
                  actorId: 'user-1',
                  sourceTable: 'vfs_crdt_client_push',
                  sourceId: 'user-1:desktop:7:desktop-7',
                  occurredAt: '2026-02-14T20:10:07.000Z'
                }
              ],
              nextCursor: encodeVfsSyncCursor({
                changedAt: '2026-02-14T20:10:07.000Z',
                changeId: 'desktop-7'
              }),
              hasMore: false,
              lastReconciledWriteIds: { desktop: 7 }
            },
            reconcile: {
              clientId: 'desktop',
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-14T20:10:07.000Z',
                changeId: 'desktop-7'
              }),
              lastReconciledWriteIds: { desktop: 7 }
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/x-protobuf' }
          }
        )
    );
    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    const result = await transport.syncSession({
      userId: 'user-1',
      clientId: 'desktop',
      cursor: {
        changedAt: '2026-02-14T20:10:06.000Z',
        changeId: 'desktop-6'
      },
      limit: 100,
      operations: [
        {
          opId: 'desktop-6',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 6,
          occurredAt: '2026-02-14T20:10:06.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ],
      lastReconciledWriteIds: {
        desktop: 6
      }
    });

    expect(result).toEqual({
      push: {
        results: [{ opId: 'desktop-6', status: 'applied' }]
      },
      pull: {
        items: [
          expect.objectContaining({
            opId: 'desktop-7',
            sourceId: 'user-1:desktop:7:desktop-7'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-14T20:10:07.000Z',
          changeId: 'desktop-7'
        },
        lastReconciledWriteIds: { desktop: 7 }
      },
      reconcile: {
        cursor: {
          changedAt: '2026-02-14T20:10:07.000Z',
          changeId: 'desktop-7'
        },
        lastReconciledWriteIds: { desktop: 7 }
      }
    });

    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBe('https://sync.example.com/v1/vfs/crdt/session');
    const requestInit = firstCall?.[1];
    const requestBytes = await readRequestBodyBytes(requestInit?.body);
    const decodedBody = decodeVfsCrdtSyncSessionRequestProtobuf(requestBytes);
    if (
      typeof decodedBody !== 'object' ||
      decodedBody === null ||
      !('clientId' in decodedBody) ||
      !('operations' in decodedBody)
    ) {
      throw new Error('expected sync session protobuf payload');
    }
    expect(decodedBody.clientId).toBe('desktop');
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
