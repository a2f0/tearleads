import { Code, ConnectError } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callLegacyBinaryRoute,
  callLegacyJsonRoute,
  setOptionalNonNegativeIntQueryParam,
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

  it('forwards non-empty extra headers to legacy routes', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55120'
      })
    };

    await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/revenuecat/webhooks',
      jsonBody: '{"event":{"id":"evt-1"}}',
      extraHeaders: {
        'x-revenuecat-signature': 'sig-1',
        'x-extra-empty': '  '
      }
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error('Expected request headers');
    }
    expect(headers.get('x-revenuecat-signature')).toBe('sig-1');
    expect(headers.get('x-extra-empty')).toBeNull();
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

  it('returns empty json object text for reset content and whitespace bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 205 }));
    fetchMock.mockResolvedValueOnce(new Response('   ', { status: 200 }));

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55116'
      })
    };

    const resetContentResult = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/chat/completions',
      jsonBody: '{"messages":[]}'
    });
    const whitespaceResult = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/context'
    });

    expect(resetContentResult).toBe('{}');
    expect(whitespaceResult).toBe('{}');
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

  it('maps additional HTTP status codes to expected connect error codes', async () => {
    const cases = [
      { status: 400, expectedCode: Code.InvalidArgument },
      { status: 403, expectedCode: Code.PermissionDenied },
      { status: 404, expectedCode: Code.NotFound },
      { status: 409, expectedCode: Code.AlreadyExists },
      { status: 412, expectedCode: Code.FailedPrecondition },
      { status: 429, expectedCode: Code.ResourceExhausted },
      { status: 501, expectedCode: Code.Unimplemented },
      { status: 503, expectedCode: Code.Unavailable },
      { status: 504, expectedCode: Code.DeadlineExceeded },
      { status: 500, expectedCode: Code.Internal },
      { status: 418, expectedCode: Code.Unknown }
    ];

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55117'
      })
    };

    for (const testCase of cases) {
      fetchMock.mockResolvedValueOnce(
        new Response(`status-${testCase.status}`, { status: testCase.status })
      );
      try {
        await callLegacyJsonRoute({
          context,
          method: 'GET',
          path: '/admin/context'
        });
        throw new Error(`Expected ${testCase.status} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectError);
        if (!(error instanceof ConnectError)) {
          throw error;
        }
        expect(error.code).toBe(testCase.expectedCode);
      }
    }
  });

  it('uses configured base url and trims trailing slashes', async () => {
    vi.stubEnv(
      'CONNECT_LEGACY_BASE_URL',
      'https://legacy.example.test/custom///'
    );
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const context: MockContext = {
      requestHeader: new Headers({
        authorization: '   ',
        'x-organization-id': ''
      })
    };

    await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/keys/me'
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://legacy.example.test/custom/vfs/keys/me');
    const headers = init?.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error('Expected request headers');
    }
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-organization-id')).toBeNull();
  });

  it('uses localhost port fallback when test host header is absent', async () => {
    vi.stubEnv('PORT', '55999');
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const context: MockContext = {
      requestHeader: new Headers()
    };

    await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/vfs-sync'
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:55999/v1/vfs/vfs-sync');
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

  it('returns binary payloads without content type when header is absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([8, 9]), { status: 200 })
    );

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55118'
      })
    };

    const result = await callLegacyBinaryRoute({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-2'
    });

    expect(Array.from(result.data)).toEqual([8, 9]);
    expect(result.contentType).toBeUndefined();
  });

  it('normalizes utility helpers', () => {
    const params = new URLSearchParams();
    setOptionalStringQueryParam(params, 'cursor', 'cursor-1');
    setOptionalStringQueryParam(params, 'clientId', '   ');
    setOptionalStringQueryParam(params, 'rootId', '');
    setOptionalPositiveIntQueryParam(params, 'limit', 20);
    setOptionalPositiveIntQueryParam(params, 'batch', Number.NaN);
    setOptionalPositiveIntQueryParam(params, 'offset', 0);
    setOptionalNonNegativeIntQueryParam(params, 'offset0', 0);
    setOptionalNonNegativeIntQueryParam(params, 'offsetNeg', -1);

    expect(params.get('cursor')).toBe('cursor-1');
    expect(params.get('clientId')).toBeNull();
    expect(params.get('rootId')).toBeNull();
    expect(params.get('limit')).toBe('20');
    expect(params.get('batch')).toBeNull();
    expect(params.get('offset')).toBeNull();
    expect(params.get('offset0')).toBe('0');
    expect(params.get('offsetNeg')).toBeNull();

    expect(toJsonBody('')).toBe('{}');
    expect(toJsonBody('   ')).toBe('{}');
    expect(toJsonBody(' {"a":1} ')).toBe(' {"a":1} ');
  });

  it('uses structured fallback for empty and non-standard error payloads', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"denied"}', { status: 400 })
    );
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));

    const context: MockContext = {
      requestHeader: new Headers({
        host: '127.0.0.1:55119'
      })
    };

    try {
      await callLegacyJsonRoute({
        context,
        method: 'GET',
        path: '/admin/context'
      });
      throw new Error('Expected invalid argument error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.message).toContain('{"message":"denied"}');
    }

    try {
      await callLegacyJsonRoute({
        context,
        method: 'GET',
        path: '/admin/context'
      });
      throw new Error('Expected not found error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      expect(error.code).toBe(Code.NotFound);
      expect(error.message).toContain(
        'Legacy route proxy failed with status 404'
      );
    }
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
