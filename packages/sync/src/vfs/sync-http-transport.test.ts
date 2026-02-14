import { describe, expect, it, vi } from 'vitest';
import { encodeVfsSyncCursor } from './sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getHeaderValue(init: unknown, headerName: string): string | null {
  if (!isRecord(init)) {
    return null;
  }

  const rawHeaders = init['headers'];
  if (rawHeaders instanceof Headers) {
    return rawHeaders.get(headerName);
  }

  if (Array.isArray(rawHeaders)) {
    const normalizedName = headerName.toLowerCase();
    for (const entry of rawHeaders) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }

      const candidateName = entry[0];
      const candidateValue = entry[1];
      if (
        typeof candidateName === 'string' &&
        typeof candidateValue === 'string' &&
        candidateName.toLowerCase() === normalizedName
      ) {
        return candidateValue;
      }
    }

    return null;
  }

  if (!isRecord(rawHeaders)) {
    return null;
  }

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (
      key.toLowerCase() === headerName.toLowerCase() &&
      typeof value === 'string'
    ) {
      return value;
    }
  }

  return null;
}

function getJsonBody(init: unknown): unknown {
  if (!isRecord(init)) {
    return null;
  }

  const rawBody = init['body'];
  if (typeof rawBody !== 'string') {
    return null;
  }

  return JSON.parse(rawBody);
}

describe('VfsHttpCrdtSyncTransport', () => {
  it('pushes operations to the CRDT push endpoint with auth headers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          clientId: 'desktop',
          results: [
            {
              opId: 'desktop-1',
              status: 'applied'
            }
          ]
        }),
        { status: 200 }
      )
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
    expect(getHeaderValue(requestInit, 'Authorization')).toBe('Bearer token-1');
    expect(getHeaderValue(requestInit, 'Content-Type')).toBe('application/json');
    expect(getJsonBody(requestInit)).toEqual({
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

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
        { status: 200 }
      )
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

    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    if (typeof requestUrl !== 'string') {
      throw new Error('Expected request URL');
    }

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/v1/vfs/crdt/sync');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe(encodeVfsSyncCursor(cursor));
  });

  it('reconciles cursor/write ids through the CRDT reconcile endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
        { status: 200 }
      )
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe('https://sync.example.com/v1/vfs/crdt/reconcile');
    expect(getJsonBody(firstCall?.[1])).toEqual({
      clientId: 'desktop',
      cursor: encodeVfsSyncCursor({
        changedAt: '2026-02-14T20:10:04.000Z',
        changeId: 'desktop-4'
      }),
      lastReconciledWriteIds: {
        desktop: 4
      }
    });
  });

  it('throws with server-provided error details for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () =>
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
    const fetchMock = vi.fn(async () =>
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
    const fetchMock = vi.fn(async () =>
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
    const fetchMock = vi.fn(async () =>
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
    const fetchMock = vi.fn(async () =>
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
});
