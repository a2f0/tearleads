import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import type { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

const PUSH_CRDT_OPS_PATH = `${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps`;
const GET_CRDT_SYNC_PATH = `${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`;
const RECONCILE_CRDT_PATH = `${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt`;
const RUN_CRDT_SESSION_PATH = `${VFS_V2_CONNECT_BASE_PATH}/RunCrdtSession`;

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

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected ${fieldName} to be an object`);
  }
  return value;
}

function parseConnectEnvelopeBody(
  body: unknown,
  fieldName: string
): Record<string, unknown> {
  const parsedBody = asRecord(body, fieldName);
  const encodedPayload = parsedBody['json'];
  if (typeof encodedPayload !== 'string') {
    throw new Error(`expected ${fieldName}.json to be a string`);
  }
  return asRecord(JSON.parse(encodedPayload), `${fieldName}.json`);
}

describe('VfsHttpCrdtSyncTransport', () => {
  it('pushes operations to Connect CRDT endpoint with auth headers', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
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
    expect(requestBody['organizationId']).toBe('org-1');
    const decodedBody = parseConnectEnvelopeBody(requestBody, 'push request');
    expect(decodedBody['clientId']).toBe('desktop');
    const operations = decodedBody['operations'];
    if (!Array.isArray(operations)) {
      throw new Error('expected push request operations');
    }
    expect(operations[0]).toEqual(
      expect.objectContaining({ opId: 'desktop-1' })
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
      changeId: 'desktop-1'
    };
    const nextCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:01.000Z',
      changeId: 'desktop-2'
    });

    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
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
        changeId: 'desktop-2'
      },
      lastReconciledWriteIds: {
        desktop: 2,
        mobile: 5
      }
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
    const requestUrl = firstCall?.[0];
    expect(requestUrl).toBeTypeOf('string');
    const parsedRequestUrl = new URL(String(requestUrl));
    expect(parsedRequestUrl.pathname).toBe(RECONCILE_CRDT_PATH);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'reconcile request'
    );
    expect(requestBody['organizationId']).toBe('org-1');
    const decodedBody = parseConnectEnvelopeBody(
      requestBody,
      'reconcile request'
    );
    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');

    expect(decodedBody['clientId']).toBe('desktop');
    expect(decodedBody['cursor']).toBe(
      encodeVfsSyncCursor({
        changedAt: '2026-02-14T20:10:04.000Z',
        changeId: 'desktop-4'
      })
    );
    expect(decodedBody['lastReconciledWriteIds']).toEqual({ desktop: 4 });
  });

  it('runs unified sync session over Connect and parses typed results', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          connectJsonEnvelope({
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
    expect(requestUrl).toBe(`https://sync.example.com${RUN_CRDT_SESSION_PATH}`);

    const requestInit = firstCall?.[1];
    const requestBody = asRecord(
      await readRequestJson(requestUrl, requestInit),
      'session request'
    );
    const requestHeaders = new Headers(requestInit?.headers);
    expect(requestHeaders.get('X-Organization-Id')).toBe('org-1');
    expect(requestBody['organizationId']).toBe('org-1');
    const decodedBody = parseConnectEnvelopeBody(
      requestBody,
      'session request'
    );
    expect(decodedBody['clientId']).toBe('desktop');
    expect(decodedBody['operations']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opId: 'desktop-6'
        })
      ])
    );
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
