import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsBlobNetworkFlusherPersistedState } from './vfsBlobNetworkFlusher';

function getAuthorizationHeader(init: RequestInit | undefined): string | null {
  if (!init || !init.headers) {
    return null;
  }

  return new Headers(init.headers).get('Authorization');
}

describe('vfsBlobNetworkFlusher', () => {
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

  it('retries stage request after token refresh on 401', async () => {
    localStorage.setItem('auth_token', 'stale-access-token');
    localStorage.setItem('auth_refresh_token', 'refresh-token');

    let stageAttempts = 0;
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

        if (url.endsWith('/v1/vfs/blobs/stage')) {
          stageAttempts += 1;
          if (stageAttempts === 1) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          return new Response(
            JSON.stringify({
              stagingId: 'stage-1',
              blobId: 'blob-1',
              status: 'staged',
              stagedAt: '2026-02-18T00:00:00.000Z',
              expiresAt: '2026-02-18T01:00:00.000Z'
            }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }

        throw new Error(`Unexpected request URL: ${url}`);
      }
    );

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      apiPrefix: '/v1'
    });
    flusher.queueStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });

    await expect(flusher.flush()).resolves.toEqual({
      processedOperations: 1,
      pendingOperations: 0
    });

    const stageCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([input]) =>
        input.toString().endsWith('/v1/vfs/blobs/stage')
      );
    expect(stageCalls).toHaveLength(2);

    const firstStageCall = stageCalls[0];
    if (!firstStageCall) {
      throw new Error('expected first stage call');
    }
    const secondStageCall = stageCalls[1];
    if (!secondStageCall) {
      throw new Error('expected second stage call');
    }

    expect(getAuthorizationHeader(firstStageCall[1])).toBe(
      'Bearer stale-access-token'
    );
    expect(getAuthorizationHeader(secondStageCall[1])).toBe(
      'Bearer fresh-access-token'
    );
  });

  it('flushes queued stage/attach/abandon operations and persists state', async () => {
    const saveState = vi.fn(
      async (state: VfsBlobNetworkFlusherPersistedState) => state
    );
    vi.mocked(global.fetch).mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url.endsWith('/v1/vfs/blobs/stage')) {
          return new Response(
            JSON.stringify({
              stagingId: 'stage-1',
              blobId: 'blob-1',
              status: 'staged',
              stagedAt: '2026-02-18T00:00:00.000Z',
              expiresAt: '2026-02-18T01:00:00.000Z'
            }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.endsWith('/v1/vfs/blobs/stage/stage-1/attach')) {
          return new Response(
            JSON.stringify({
              attached: true,
              stagingId: 'stage-1',
              blobId: 'blob-1',
              itemId: 'item-1',
              relationKind: 'file',
              refId: 'ref-1',
              attachedAt: '2026-02-18T00:00:10.000Z'
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        if (url.endsWith('/v1/vfs/blobs/stage/stage-1/abandon')) {
          return new Response(
            JSON.stringify({
              abandoned: true,
              stagingId: 'stage-1',
              status: 'abandoned'
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

    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost',
      saveState
    });

    await flusher.queueStageAndPersist({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    await flusher.queueAttachAndPersist({
      stagingId: 'stage-1',
      itemId: 'item-1',
      relationKind: 'file'
    });
    await flusher.queueAbandonAndPersist({
      stagingId: 'stage-1'
    });

    expect(flusher.queuedOperations()).toHaveLength(3);
    await expect(flusher.flush()).resolves.toEqual({
      processedOperations: 3,
      pendingOperations: 0
    });
    expect(flusher.queuedOperations()).toHaveLength(0);
    expect(saveState).toHaveBeenCalled();
  });

  it('hydrates queued operations from persistence callback', async () => {
    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const source = new VfsBlobNetworkFlusher();
    source.queueStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });
    const persisted = source.exportState();

    const target = new VfsBlobNetworkFlusher({
      loadState: async () => persisted
    });
    await expect(target.hydrateFromPersistence()).resolves.toBe(true);
    expect(target.queuedOperations()).toHaveLength(1);
  });

  it('validates queue inputs and hydration payloads', async () => {
    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher();

    expect(() =>
      flusher.queueStage({ blobId: '', expiresAt: '2026-02-18T01:00:00.000Z' })
    ).toThrow(/blobId is required/);
    expect(() =>
      flusher.queueStage({ blobId: 'blob-1', expiresAt: 'invalid' })
    ).toThrow(/expiresAt must be a valid ISO timestamp/);
    expect(() => flusher.queueAttach({ stagingId: '', itemId: 'item-1' })).toThrow(
      /stagingId is required/
    );
    expect(() => flusher.queueAttach({ stagingId: 'stage-1', itemId: '' })).toThrow(
      /itemId is required/
    );
    expect(() => flusher.queueAbandon({ stagingId: '' })).toThrow(
      /stagingId is required/
    );

    const invalidOperationState = JSON.parse('{"pendingOperations":[{}]}');
    expect(() => flusher.hydrateState(invalidOperationState)).toThrow(
      /operation\.operationId is required/
    );
  });

  it('handles non-json responses and invalid queue operation kinds', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response('not-json', { status: 200 })
    );
    const { VfsBlobNetworkFlusher } = await import('./vfsBlobNetworkFlusher');
    const flusher = new VfsBlobNetworkFlusher({
      baseUrl: 'http://localhost'
    });
    flusher.queueStage({
      stagingId: 'stage-1',
      blobId: 'blob-1',
      expiresAt: '2026-02-18T01:00:00.000Z'
    });

    await expect(flusher.flush()).rejects.toThrow(
      /transport returned non-JSON response/
    );
    const unknownKindState = JSON.parse(
      '{"pendingOperations":[{"operationId":"op-1","kind":"unknown","payload":{}}]}'
    );
    expect(() => flusher.hydrateState(unknownKindState)).toThrow(
      /operation\.kind is invalid/
    );
  });
});
