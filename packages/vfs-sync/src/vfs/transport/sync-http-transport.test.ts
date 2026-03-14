import { describe, expect, it, vi } from 'vitest';
import type { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';
import {
  asRecord,
  CURSOR_CHANGE_ID_1,
  CURSOR_CHANGE_ID_2,
  CURSOR_CHANGE_ID_4,
  CURSOR_CHANGE_ID_5,
  CURSOR_CHANGE_ID_6,
  CURSOR_CHANGE_ID_7,
  connectJsonEnvelope,
  encodeUtf8ToBase64,
  GET_CRDT_SYNC_PATH,
  OLDEST_CURSOR_CHANGE_ID,
  PUSH_CRDT_OPS_PATH,
  RECONCILE_CRDT_PATH,
  REQUESTED_CURSOR_CHANGE_ID,
  RUN_CRDT_SESSION_PATH
} from './syncHttpTransportTestHelpers.js';

async function readRequestJson(
  input: unknown,
  init: RequestInit | undefined
): Promise<unknown> {
  if (typeof init?.body === 'string') {
    return JSON.parse(init.body);
  }
  if (input instanceof Request) {
    const text = await input.clone().text();
    if (text.trim().length > 0) {
      return JSON.parse(text);
    }
  }
  throw new Error('expected request body to be JSON');
}

describe('VfsHttpCrdtSyncTransport', () => {
  it('pushes operations to Connect CRDT endpoint with auth headers', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
          clientId: encodeUtf8ToBase64('desktop'),
          results: [
            {
              opId: encodeUtf8ToBase64('desktop-1'),
              status: 'applied'
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      getAuthToken: () => 'token-1',
      organizationId: 'org-1'
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
    expect(requestUrl).toBe(`https://sync.example.com${PUSH_CRDT_OPS_PATH}`);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'push request'
    );
    expect(requestBody['organizationId']).toBe(encodeUtf8ToBase64('org-1'));
    expect(requestBody['clientId']).toBe(encodeUtf8ToBase64('desktop'));
    const operations = requestBody['operations'];
    if (!Array.isArray(operations)) {
      throw new Error('expected push request operations');
    }
    expect(operations[0]).toEqual(
      expect.objectContaining({
        opId: encodeUtf8ToBase64('desktop-1'),
        opType: 1,
        itemId: encodeUtf8ToBase64('item-1'),
        replicaId: encodeUtf8ToBase64('desktop'),
        writeId: 1,
        occurredAtMs: Date.parse('2026-02-14T20:00:00.000Z'),
        principalType: 2,
        principalId: encodeUtf8ToBase64('group-1'),
        accessLevel: 1
      })
    );

    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/json');
    expect(requestHeaders.get('Content-Type')).toBe('application/json');
    expect(requestHeaders.get('Authorization')).toBe('Bearer token-1');
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');
  });

  it('pulls operations, decodes cursor, and includes replica write ids', async () => {
    const cursor = {
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: CURSOR_CHANGE_ID_1
    };
    const nextCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:01.000Z',
      changeId: CURSOR_CHANGE_ID_2
    });

    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
          items: [
            {
              opId: encodeUtf8ToBase64('desktop-2'),
              itemId: encodeUtf8ToBase64('item-1'),
              opType: 'acl_add',
              principalType: 'group',
              principalId: encodeUtf8ToBase64('group-1'),
              accessLevel: 'write',
              parentId: null,
              childId: null,
              actorId: encodeUtf8ToBase64('user-1'),
              sourceTable: 'vfs_crdt_client_push',
              sourceId: encodeUtf8ToBase64('user-1:desktop:2:desktop-2'),
              occurredAtMs: Date.parse('2026-02-14T20:10:01.000Z')
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
          headers: { 'Content-Type': 'application/json' }
        }
      );
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      getOrganizationId: () => 'org-1'
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
        changeId: CURSOR_CHANGE_ID_2
      },
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 5
      },
      bloomFilter: null
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBeTypeOf('string');
    const parsedRequestUrl = new URL(String(requestUrl));
    expect(parsedRequestUrl.pathname).toBe(GET_CRDT_SYNC_PATH);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'pull request'
    );
    expect(requestBody['limit']).toBe(25);
    expect(requestBody['cursor']).toBe(encodeVfsSyncCursor(cursor));
    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');
  });

  it('reconciles cursor/write ids through Connect CRDT endpoint', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
          clientId: encodeUtf8ToBase64('desktop'),
          cursor: encodeVfsSyncCursor({
            changedAt: '2026-02-14T20:10:05.000Z',
            changeId: CURSOR_CHANGE_ID_5
          }),
          lastReconciledWriteIds: {
            desktop: 5,
            mobile: 3
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: 'org-1'
    });

    const result = await transport.reconcileState({
      userId: 'user-1',
      clientId: 'desktop',
      cursor: {
        changedAt: '2026-02-14T20:10:04.000Z',
        changeId: CURSOR_CHANGE_ID_4
      },
      lastReconciledWriteIds: {
        desktop: 4
      }
    });

    expect(result).toEqual({
      cursor: {
        changedAt: '2026-02-14T20:10:05.000Z',
        changeId: CURSOR_CHANGE_ID_5
      },
      lastReconciledWriteIds: {
        desktop: 5,
        mobile: 3
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBeTypeOf('string');
    const parsedRequestUrl = new URL(String(requestUrl));
    expect(parsedRequestUrl.pathname).toBe(RECONCILE_CRDT_PATH);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'reconcile request'
    );
    expect(requestBody['organizationId']).toBe(encodeUtf8ToBase64('org-1'));
    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');

    expect(requestBody['clientId']).toBe(encodeUtf8ToBase64('desktop'));
    expect(requestBody['cursor']).toBe(
      encodeVfsSyncCursor({
        changedAt: '2026-02-14T20:10:04.000Z',
        changeId: CURSOR_CHANGE_ID_4
      })
    );
    expect(requestBody['lastReconciledWriteIds']).toEqual({ desktop: 4 });
  });

  it('runs unified sync session over Connect and parses typed results', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          connectJsonEnvelope({
            push: {
              clientId: encodeUtf8ToBase64('desktop'),
              results: [
                { opId: encodeUtf8ToBase64('desktop-6'), status: 'applied' }
              ]
            },
            pull: {
              items: [
                {
                  opId: encodeUtf8ToBase64('desktop-7'),
                  itemId: encodeUtf8ToBase64('item-1'),
                  opType: 'acl_add',
                  principalType: 'group',
                  principalId: encodeUtf8ToBase64('group-1'),
                  accessLevel: 'read',
                  parentId: null,
                  childId: null,
                  actorId: encodeUtf8ToBase64('user-1'),
                  sourceTable: 'vfs_crdt_client_push',
                  sourceId: encodeUtf8ToBase64('user-1:desktop:7:desktop-7'),
                  occurredAtMs: Date.parse('2026-02-14T20:10:07.000Z')
                }
              ],
              nextCursor: encodeVfsSyncCursor({
                changedAt: '2026-02-14T20:10:07.000Z',
                changeId: CURSOR_CHANGE_ID_7
              }),
              hasMore: false,
              lastReconciledWriteIds: { desktop: 7 }
            },
            reconcile: {
              clientId: encodeUtf8ToBase64('desktop'),
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-14T20:10:07.000Z',
                changeId: CURSOR_CHANGE_ID_7
              }),
              lastReconciledWriteIds: { desktop: 7 }
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: 'org-1'
    });

    const result = await transport.syncSession({
      userId: 'user-1',
      clientId: 'desktop',
      cursor: {
        changedAt: '2026-02-14T20:10:06.000Z',
        changeId: CURSOR_CHANGE_ID_6
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
          changeId: CURSOR_CHANGE_ID_7
        },
        lastReconciledWriteIds: { desktop: 7 },
        bloomFilter: null
      },
      reconcile: {
        cursor: {
          changedAt: '2026-02-14T20:10:07.000Z',
          changeId: CURSOR_CHANGE_ID_7
        },
        lastReconciledWriteIds: { desktop: 7 }
      }
    });

    const firstCall = fetchMock.mock.calls[0];
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBe(`https://sync.example.com${RUN_CRDT_SESSION_PATH}`);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'session request'
    );
    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');
    expect(requestBody['organizationId']).toBe(encodeUtf8ToBase64('org-1'));
    expect(requestBody['clientId']).toBe(encodeUtf8ToBase64('desktop'));
    expect(requestBody['operations']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opId: encodeUtf8ToBase64('desktop-6')
        })
      ])
    );
  });

  it('throws typed rematerialization error for 409 stale-cursor responses', async () => {
    const requestedCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: REQUESTED_CURSOR_CHANGE_ID
    });
    const oldestAvailableCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: OLDEST_CURSOR_CHANGE_ID
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
          changeId: REQUESTED_CURSOR_CHANGE_ID
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
