import { Code, ConnectError } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callRouteBinaryHandler,
  callRouteJsonHandler,
  encoded,
  setOptionalNonNegativeIntQueryParam,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';
import { executeRoute } from './legacyRouteProxyExecution.js';

const { executeRouteMock } = vi.hoisted(() => ({
  executeRouteMock: vi.fn<(options: unknown) => Promise<unknown>>()
}));

vi.mock('./legacyRouteProxyExecution.js', () => ({
  executeRoute: executeRouteMock
}));

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

describe('legacyRouteProxy', () => {
  beforeEach(() => {
    executeRouteMock.mockReset();
  });

  it('returns route handler json bodies on success', async () => {
    const context = createContext();
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: '{"ok":true}'
    });

    const result = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/admin/context'
    });

    expect(result).toBe('{"ok":true}');
    expect(executeRoute).toHaveBeenCalledWith({
      context,
      method: 'GET',
      path: '/admin/context'
    });
  });

  it('normalizes successful empty json payloads', async () => {
    const context = createContext();

    executeRouteMock.mockResolvedValueOnce({
      status: 204,
      body: undefined
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 205,
      body: null
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: ' '
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: new Uint8Array([])
    });

    await expect(
      callRouteJsonHandler({
        context,
        method: 'DELETE',
        path: '/vfs/blobs/blob-1'
      })
    ).resolves.toBe('{}');

    await expect(
      callRouteJsonHandler({
        context,
        method: 'POST',
        path: '/chat/completions'
      })
    ).resolves.toBe('{}');

    await expect(
      callRouteJsonHandler({
        context,
        method: 'GET',
        path: '/admin/context'
      })
    ).resolves.toBe('{}');

    await expect(
      callRouteJsonHandler({
        context,
        method: 'GET',
        path: '/admin/context'
      })
    ).resolves.toBe('{}');

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: undefined
    });

    await expect(
      callRouteJsonHandler({
        context,
        method: 'GET',
        path: '/admin/context'
      })
    ).resolves.toBe('{}');
  });

  it('serializes non-string json payloads', async () => {
    const context = createContext();

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: {
        items: ['a', 'b']
      }
    });

    const result = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/mls/welcome-messages'
    });

    expect(result).toBe('{"items":["a","b"]}');
  });

  it('maps route handler status codes to connect error codes', async () => {
    const context = createContext();

    const statusCases = [
      { status: 400, code: Code.InvalidArgument },
      { status: 401, code: Code.Unauthenticated },
      { status: 403, code: Code.PermissionDenied },
      { status: 404, code: Code.NotFound },
      { status: 409, code: Code.AlreadyExists },
      { status: 412, code: Code.FailedPrecondition },
      { status: 429, code: Code.ResourceExhausted },
      { status: 501, code: Code.Unimplemented },
      { status: 503, code: Code.Unavailable },
      { status: 504, code: Code.DeadlineExceeded },
      { status: 500, code: Code.Internal },
      { status: 418, code: Code.Unknown }
    ];

    for (const testCase of statusCases) {
      executeRouteMock.mockResolvedValueOnce({
        status: testCase.status,
        body: `status-${testCase.status}`
      });

      try {
        await callRouteJsonHandler({
          context,
          method: 'GET',
          path: '/admin/context'
        });
        throw new Error('Expected callRouteJsonHandler to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectError);
        if (!(error instanceof ConnectError)) {
          throw error;
        }

        expect(error.code).toBe(testCase.code);
        expect(error.message).toContain(`status-${testCase.status}`);
      }
    }
  });

  it('uses structured fallback error messages when payload is not a string', async () => {
    const context = createContext();

    executeRouteMock.mockResolvedValueOnce({
      status: 400,
      body: { error: 'bad-input' }
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 400,
      body: { message: 'denied' }
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 400,
      body: {}
    });

    const errorMessages = [
      'bad-input',
      'denied',
      'Route handler failed with status 400'
    ];

    for (const expectedMessage of errorMessages) {
      try {
        await callRouteJsonHandler({
          context,
          method: 'GET',
          path: '/admin/context'
        });
        throw new Error('Expected callRouteJsonHandler to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectError);
        if (!(error instanceof ConnectError)) {
          throw error;
        }

        expect(error.code).toBe(Code.InvalidArgument);
        expect(error.message).toContain(expectedMessage);
      }
    }
  });

  it('returns binary payloads and content type from route handlers', async () => {
    const context = createContext();

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream'
    });

    const result = await callRouteBinaryHandler({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-1'
    });

    expect(Array.from(result.data)).toEqual([1, 2, 3]);
    expect(result.contentType).toBe('application/octet-stream');
  });

  it('normalizes non-uint8 binary payloads', async () => {
    const context = createContext();

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: 'abc'
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: [5.9, 6.1]
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: {
        ignored: true
      }
    });

    const stringResult = await callRouteBinaryHandler({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-2'
    });
    expect(Array.from(stringResult.data)).toEqual([97, 98, 99]);

    const arrayResult = await callRouteBinaryHandler({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-3'
    });
    expect(Array.from(arrayResult.data)).toEqual([5, 6]);

    const emptyResult = await callRouteBinaryHandler({
      context,
      method: 'GET',
      path: '/vfs/blobs/blob-4'
    });
    expect(Array.from(emptyResult.data)).toEqual([]);

    executeRouteMock.mockResolvedValueOnce({
      status: 400,
      body: []
    });
    await expect(
      callRouteJsonHandler({
        context,
        method: 'GET',
        path: '/admin/context'
      })
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: () => 'not-serializable'
    });
    await expect(
      callRouteJsonHandler({
        context,
        method: 'GET',
        path: '/admin/context'
      })
    ).resolves.toBe('{}');
  });

  it('normalizes helper utility behavior', () => {
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
    expect(encoded('a/b c')).toBe('a%2Fb%20c');
  });
});
