import type {
  VfsBackgroundSyncClientPersistedState,
  VfsCrdtOperation,
  VfsCrdtSyncTransport
} from '@tearleads/vfs-sync/vfs';
import {
  encodeVfsCrdtPushResponseProtobuf,
  encodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsCrdtSyncResponseProtobuf,
  encodeVfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function getAuthorizationHeader(init: RequestInit | undefined): string | null {
  if (!init || !init.headers) {
    return null;
  }

  return new Headers(init.headers).get('Authorization');
}

describe('vfsNetworkFlusher', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('retries CRDT push with refreshed auth token on 401', async () => {
    localStorage.setItem('auth_token', 'stale-access-token');
    localStorage.setItem('auth_refresh_token', 'refresh-token');

    let pushAttempt = 0;
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url.endsWith('/auth/refresh')) {
          return new Response(
            JSON.stringify({
              accessToken: 'fresh-access-token',
              refreshToken: 'fresh-refresh-token',
              tokenType: 'Bearer',
              expiresIn: 3600,
              refreshExpiresIn: 604800,
              user: { id: 'user-1', email: 'user@example.com' }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        if (url.endsWith('/v1/vfs/crdt/push')) {
          pushAttempt += 1;
          if (pushAttempt === 1) {
            return new Response(null, { status: 401 });
          }

          return new Response(
            encodeVfsCrdtPushResponseProtobuf({
              clientId: 'desktop',
              results: [{ opId: 'op-1', status: 'applied' }]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/x-protobuf' }
            }
          );
        }

        throw new Error(`Unexpected request URL: ${url}`);
      }
    );

    const { createVfsApiCrdtTransport } = await import('./vfsNetworkFlusher');
    const transport = createVfsApiCrdtTransport({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1'
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: [
          {
            opId: 'op-1',
            opType: 'link_add',
            itemId: 'child-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: '2026-02-18T00:00:00.000Z',
            parentId: 'parent-1',
            childId: 'child-1'
          }
        ]
      })
    ).resolves.toEqual({
      results: [{ opId: 'op-1', status: 'applied' }]
    });

    const pushCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([input]) =>
        input.toString().endsWith('/v1/vfs/crdt/push')
      );
    expect(pushCalls).toHaveLength(2);

    const firstPushCall = pushCalls[0];
    if (!firstPushCall) {
      throw new Error('expected first push call');
    }
    const secondPushCall = pushCalls[1];
    if (!secondPushCall) {
      throw new Error('expected second push call');
    }

    expect(getAuthorizationHeader(firstPushCall[1])).toBe(
      'Bearer stale-access-token'
    );
    expect(getAuthorizationHeader(secondPushCall[1])).toBe(
      'Bearer fresh-access-token'
    );
  });

  it('flushes queued operations and persists client state', async () => {
    const pushOperations = vi.fn(
      async ({
        operations
      }: {
        userId: string;
        clientId: string;
        operations: VfsCrdtOperation[];
      }) => ({
        results: operations.map(
          (operation): { opId: string; status: 'applied' } => {
            return {
              opId: operation.opId,
              status: 'applied'
            };
          }
        )
      })
    );
    const pullOperations = vi.fn(async () => ({
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {}
    }));
    const reconcileState = vi.fn(async () => ({
      cursor: {
        changedAt: '2026-02-18T00:00:00.000Z',
        changeId: 'op-1'
      },
      lastReconciledWriteIds: { desktop: 1 }
    }));

    const transport: VfsCrdtSyncTransport = {
      pushOperations,
      pullOperations,
      reconcileState
    };

    const savedStates: VfsBackgroundSyncClientPersistedState[] = [];
    const saveState = vi.fn(
      async (state: VfsBackgroundSyncClientPersistedState) => {
        savedStates.push(state);
      }
    );

    const { VfsApiNetworkFlusher } = await import('./vfsNetworkFlusher');
    const flusher = new VfsApiNetworkFlusher('user-1', 'desktop', {
      transport,
      saveState
    });

    await flusher.queueLocalOperationAndPersist({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    expect(savedStates).toHaveLength(1);
    const queuedState = savedStates[0];
    if (!queuedState) {
      throw new Error('missing queued state');
    }
    expect(queuedState.pendingOperations).toHaveLength(1);

    const flushResult = await flusher.flush();
    expect(flushResult.pushedOperations).toBe(1);
    expect(pushOperations).toHaveBeenCalledTimes(1);

    const latestState = savedStates[savedStates.length - 1];
    if (!latestState) {
      throw new Error('missing latest persisted state');
    }
    expect(latestState.pendingOperations).toHaveLength(0);
  });

  it('hydrates queued state from persistence callback', async () => {
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async ({ operations }) => ({
        results: operations.map(
          (operation): { opId: string; status: 'applied' } => {
            return {
              opId: operation.opId,
              status: 'applied'
            };
          }
        )
      }),
      pullOperations: async () => ({
        items: [],
        hasMore: false,
        nextCursor: null,
        lastReconciledWriteIds: {}
      }),
      reconcileState: async ({ cursor, lastReconciledWriteIds }) => ({
        cursor,
        lastReconciledWriteIds
      })
    };

    const { VfsApiNetworkFlusher } = await import('./vfsNetworkFlusher');
    const sourceFlusher = new VfsApiNetworkFlusher('user-1', 'desktop', {
      transport
    });
    sourceFlusher.queueLocalOperation({
      opType: 'link_add',
      itemId: 'child-1',
      parentId: 'parent-1',
      childId: 'child-1'
    });
    const persistedState = sourceFlusher.exportState();

    const loadState = vi.fn(async () => persistedState);
    const targetFlusher = new VfsApiNetworkFlusher('user-1', 'desktop', {
      transport,
      loadState
    });

    await expect(targetFlusher.hydrateFromPersistence()).resolves.toBe(true);
    expect(targetFlusher.queuedOperations()).toHaveLength(1);
  });

  it('forwards rematerialization options to sync client', async () => {
    class MockRematerializationRequiredError extends Error {
      readonly code = 'crdt_rematerialization_required';
      readonly requestedCursor: string;
      readonly oldestAvailableCursor: string;

      constructor() {
        super('CRDT feed cursor requires re-materialization');
        this.name = 'VfsCrdtRematerializationRequiredError';
        this.requestedCursor = 'cursor-requested';
        this.oldestAvailableCursor = 'cursor-oldest';
      }
    }

    let pullCalls = 0;
    const onRematerializationRequired = vi.fn(async () => null);
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCalls += 1;
        if (pullCalls === 1) {
          throw new MockRematerializationRequiredError();
        }
        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        };
      },
      reconcileState: async ({ cursor, lastReconciledWriteIds }) => ({
        cursor,
        lastReconciledWriteIds
      })
    };

    const { VfsApiNetworkFlusher } = await import('./vfsNetworkFlusher');
    const flusher = new VfsApiNetworkFlusher('user-1', 'desktop', {
      transport,
      maxRematerializationAttempts: 1,
      onRematerializationRequired
    });

    await expect(flusher.sync()).resolves.toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(pullCalls).toBe(2);
    expect(onRematerializationRequired).toHaveBeenCalledTimes(1);
  });

  it('falls back to server snapshot rematerialization on stale cursor', async () => {
    let pullCalls = 0;
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();

        if (url.includes('/v1/vfs/crdt/vfs-sync')) {
          pullCalls += 1;
          if (pullCalls === 1) {
            return new Response(
              JSON.stringify({
                error:
                  'CRDT cursor is older than retained history; re-materialization required',
                code: 'crdt_rematerialization_required',
                requestedCursor: 'cursor-requested',
                oldestAvailableCursor: 'cursor-oldest'
              }),
              {
                status: 409,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }

          return new Response(
            encodeVfsCrdtSyncResponseProtobuf({
              items: [],
              hasMore: false,
              nextCursor: null,
              lastReconciledWriteIds: {}
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/x-protobuf' }
            }
          );
        }

        if (url.includes('/v1/vfs/crdt/reconcile')) {
          return new Response(
            encodeVfsCrdtReconcileResponseProtobuf({
              clientId: 'desktop',
              cursor: encodeVfsSyncCursor({
                changedAt: '2026-02-24T12:10:00.000Z',
                changeId: 'desktop-10'
              }),
              lastReconciledWriteIds: { desktop: 10 }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/x-protobuf' }
            }
          );
        }

        if (url.includes('/v1/vfs/crdt/snapshot?clientId=desktop')) {
          return new Response(
            JSON.stringify({
              replaySnapshot: {
                acl: [],
                links: [],
                cursor: null
              },
              reconcileState: {
                cursor: {
                  changedAt: '2026-02-24T12:09:59.000Z',
                  changeId: 'desktop-9'
                },
                lastReconciledWriteIds: {
                  desktop: '9'
                }
              },
              containerClocks: [],
              snapshotUpdatedAt: '2026-02-24T12:10:00.000Z'
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        throw new Error(`Unexpected request URL: ${url}`);
      }
    );

    const { VfsApiNetworkFlusher } = await import('./vfsNetworkFlusher');
    const onRematerializationRequired = vi.fn(async () => null);
    const flusher = new VfsApiNetworkFlusher('user-1', 'desktop', {
      transportOptions: {
        baseUrl: 'http://localhost',
        apiPrefix: '/v1'
      },
      maxRematerializationAttempts: 1,
      onRematerializationRequired
    });

    await expect(flusher.sync()).resolves.toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(pullCalls).toBe(2);
    expect(onRematerializationRequired).toHaveBeenCalledTimes(1);

    const snapshotCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([input]) =>
        input.toString().includes('/v1/vfs/crdt/snapshot?clientId=desktop')
      );
    expect(snapshotCalls).toHaveLength(1);
  });
});
