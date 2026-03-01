import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callLegacyBinaryRoute,
  callLegacyJsonRoute,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

type MockContext = {
  requestHeader: Headers;
};

describe('legacyRouteProxy', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NODE_ENV', 'test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('forwards auth/org headers and query params for json calls', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const query = new URLSearchParams();
    query.set('limit', '20');

    const context: MockContext = {
      requestHeader: new Headers({
        authorization: 'Bearer token-1',
        'x-organization-id': 'org-1',
        host: '127.0.0.1:55111'
      })
    };

    const result = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/vfs-sync',
      query
    });

    expect(result).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:55111/v1/vfs/vfs-sync?limit=20');
    expect(init?.method).toBe('GET');

    const headers = init?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error('Expected request headers');
    }
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-organization-id')).toBe('org-1');
  });

  it('returns empty json object text for empty successful response bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55112'
      })
    };

    const result = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: '/mls/key-packages/key-1'
    });

    expect(result).toBe('{}');
  });

  it('maps HTTP 401 errors to unauthenticated connect errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"Unauthorized"}', {
        status: 401,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55113'
      })
    };

    try {
      await callLegacyJsonRoute({
        context,
        method: 'GET',
        path: '/admin/context'
      });
      throw new Error('Expected unauthenticated error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.code).toBe(Code.Unauthenticated);
      expect(error.message).toContain('Unauthorized');
    }
  });

  it('returns binary payloads and content type for binary calls', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
    );

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55114'
      })
    };

    const result = await callLegacyBinaryRoute({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-1'
    });

    expect(Array.from(result.data)).toEqual([1, 2, 3, 4]);
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('normalizes utility helpers', () => {
    const params = new URLSearchParams();
    setOptionalStringQueryParam(params, 'cursor', 'cursor-1');
    setOptionalStringQueryParam(params, 'rootId', '');
    setOptionalPositiveIntQueryParam(params, 'limit', 20);
    setOptionalPositiveIntQueryParam(params, 'offset', 0);

    expect(params.get('cursor')).toBe('cursor-1');
    expect(params.get('rootId')).toBeNull();
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBeNull();

    expect(toJsonBody('')).toBe('{}');
    expect(toJsonBody(' {"a":1} ')).toBe(' {"a":1} ');
  });

  it('surfaces fallback errors when network calls fail', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55115'
      })
    };

    try {
      await callLegacyJsonRoute({
        context,
        method: 'GET',
        path: '/vfs/vfs-sync'
      });
      throw new Error('Expected route call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.code).toBe(Code.Unavailable);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
