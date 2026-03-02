import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './legacyRouteProxyAuth.js';
import { executeRoute } from './legacyRouteProxyExecution.js';
import { buildRequestQuery, parseJsonBody } from './legacyRouteProxyRouting.js';

const {
  authenticateMock,
  buildRequestQueryMock,
  findRouteMock,
  parseJsonBodyMock,
  resolveAdminAccessMock,
  resolveOrganizationMembershipMock
} = vi.hoisted(() => ({
  authenticateMock: vi.fn<(headers: Headers) => Promise<unknown>>(),
  resolveOrganizationMembershipMock:
    vi.fn<
      (path: string, headers: Headers, userId: string) => Promise<unknown>
    >(),
  resolveAdminAccessMock:
    vi.fn<(path: string, session: unknown) => Promise<unknown>>(),
  findRouteMock:
    vi.fn<
      (
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string
      ) => {
        definition: {
          method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          pattern: string;
          handler: (request: unknown, response: unknown) => unknown;
        };
        params: Record<string, string>;
      } | null
    >(),
  buildRequestQueryMock:
    vi.fn<
      (searchParams: URLSearchParams | undefined) => Record<string, unknown>
    >(),
  parseJsonBodyMock:
    vi.fn<
      (
        jsonBody: string | undefined
      ) => { ok: true; value: unknown } | { ok: false; error: string }
    >()
}));

vi.mock('./legacyRouteProxyAuth.js', () => ({
  authenticate: authenticateMock,
  resolveOrganizationMembership: resolveOrganizationMembershipMock,
  resolveAdminAccess: resolveAdminAccessMock
}));

vi.mock('./legacyRouteProxyRouting.js', () => ({
  findRoute: findRouteMock,
  buildRequestQuery: buildRequestQueryMock,
  parseJsonBody: parseJsonBodyMock
}));

function createHeaders() {
  return new Headers({
    authorization: 'Bearer token-1',
    'x-organization-id': 'org-1',
    'x-test': 'header-value'
  });
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

describe('legacyRouteProxyExecution', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    resolveOrganizationMembershipMock.mockReset();
    resolveAdminAccessMock.mockReset();
    findRouteMock.mockReset();
    buildRequestQueryMock.mockReset();
    parseJsonBodyMock.mockReset();

    buildRequestQueryMock.mockReturnValue({ cursor: 'c-1' });
    parseJsonBodyMock.mockReturnValue({ ok: true, value: { item: 1 } });
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: {
        sub: 'user-1',
        jti: 'session-1',
        email: 'user-1@example.com'
      },
      session: {
        userId: 'user-1',
        email: 'user-1@example.com',
        admin: false,
        createdAt: '2026-03-02T00:00:00.000Z',
        lastActiveAt: '2026-03-02T00:00:00.000Z',
        ipAddress: '127.0.0.1'
      }
    });
    resolveOrganizationMembershipMock.mockResolvedValue({
      ok: true,
      organizationId: 'org-1'
    });
    resolveAdminAccessMock.mockResolvedValue({
      ok: true,
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-1']
      }
    });
  });

  it('returns 404 when a route is not found', async () => {
    findRouteMock.mockReturnValueOnce(null);

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/missing'
    });

    expect(result).toEqual({
      status: 404,
      body: {
        error: 'Not found'
      }
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns auth/membership/admin failures without invoking route handler', async () => {
    findRouteMock.mockReturnValue({
      definition: {
        method: 'GET',
        pattern: '/vfs/register',
        handler: vi.fn()
      },
      params: {}
    });

    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    const authResult = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });
    expect(authResult).toEqual({
      status: 401,
      body: {
        error: 'Unauthorized'
      }
    });

    authenticateMock.mockResolvedValueOnce({
      ok: true,
      claims: {
        sub: 'user-1',
        jti: 'session-1'
      },
      session: {
        userId: 'user-1',
        email: 'user-1@example.com',
        admin: false,
        createdAt: '2026-03-02T00:00:00.000Z',
        lastActiveAt: '2026-03-02T00:00:00.000Z',
        ipAddress: '127.0.0.1'
      }
    });
    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden'
    });

    const membershipResult = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });
    expect(membershipResult).toEqual({
      status: 403,
      body: {
        error: 'Forbidden'
      }
    });

    resolveOrganizationMembershipMock.mockResolvedValueOnce({
      ok: true,
      organizationId: null
    });
    resolveAdminAccessMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden admin'
    });

    const adminResult = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });
    expect(adminResult).toEqual({
      status: 403,
      body: {
        error: 'Forbidden admin'
      }
    });
  });

  it('returns 400 when request body parsing fails', async () => {
    findRouteMock.mockReturnValue({
      definition: {
        method: 'POST',
        pattern: '/vfs/register',
        handler: vi.fn()
      },
      params: {}
    });
    parseJsonBodyMock.mockReturnValueOnce({
      ok: false,
      error: 'Invalid JSON payload'
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'POST',
      path: '/vfs/register',
      jsonBody: '{'
    });

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'Invalid JSON payload'
      }
    });
  });

  it('passes adapted request/response objects to route handlers', async () => {
    const handlerSpy = vi.fn((request: unknown, response: unknown) => {
      const requestRecord = isUnknownRecord(request) ? request : null;
      const responseRecord = isUnknownRecord(response) ? response : null;

      if (!requestRecord || !responseRecord) {
        throw new Error('Expected route handler request/response objects');
      }

      const getHeader = requestRecord['get'];
      const header = requestRecord['header'];

      if (typeof getHeader !== 'function' || typeof header !== 'function') {
        throw new Error('Expected request get/header helpers');
      }

      expect(requestRecord['method']).toBe('POST');
      expect(requestRecord['path']).toBe('/vfs/register');
      expect(requestRecord['params']).toEqual({ itemId: 'item-1' });
      expect(requestRecord['query']).toEqual({ cursor: 'c-1' });
      expect(requestRecord['body']).toEqual({ item: 1 });
      expect(requestRecord['organizationId']).toBe('org-1');
      expect(requestRecord['adminAccess']).toEqual({
        isRootAdmin: false,
        organizationIds: ['org-1']
      });
      expect(getHeader('x-test')).toBe('header-value');
      expect(header('x-test')).toBe('header-value');
      expect(getHeader('missing-header')).toBeUndefined();
      expect(header('missing-header')).toBeUndefined();

      const setHeader = responseRecord['setHeader'];
      const set = responseRecord['set'];
      const type = responseRecord['type'];
      const status = responseRecord['status'];
      const send = responseRecord['send'];
      const end = responseRecord['end'];

      if (
        typeof setHeader !== 'function' ||
        typeof set !== 'function' ||
        typeof type !== 'function' ||
        typeof status !== 'function' ||
        typeof send !== 'function' ||
        typeof end !== 'function'
      ) {
        throw new Error('Expected response helpers');
      }

      setHeader('x-custom', 'abc');
      set('x-custom-2', 'def');
      type('application/custom');
      status(201);
      send({ ok: true });
      end();
    });

    findRouteMock.mockReturnValue({
      definition: {
        method: 'POST',
        pattern: '/vfs/register',
        handler: handlerSpy
      },
      params: { itemId: 'item-1' }
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'POST',
      path: '/vfs/register',
      query: new URLSearchParams('cursor=c-1'),
      jsonBody: '{"item":1}'
    });

    expect(buildRequestQuery).toHaveBeenCalledWith(
      new URLSearchParams('cursor=c-1')
    );
    expect(parseJsonBody).toHaveBeenCalledWith('{"item":1}');
    expect(result).toEqual({
      status: 201,
      body: { ok: true },
      contentType: 'application/custom'
    });
  });

  it('captures thrown route handler exceptions as internal errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    findRouteMock.mockReturnValue({
      definition: {
        method: 'GET',
        pattern: '/vfs/register',
        handler: () => {
          throw new Error('boom');
        }
      },
      params: {}
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });

    expect(result).toEqual({
      status: 500,
      body: {
        error: 'Internal server error'
      }
    });

    consoleErrorSpy.mockRestore();
  });

  it('sets default json content type when handler calls json()', async () => {
    findRouteMock.mockReturnValue({
      definition: {
        method: 'GET',
        pattern: '/vfs/register',
        handler: (_request: unknown, response: unknown) => {
          const responseRecord = isUnknownRecord(response) ? response : null;
          if (!responseRecord) {
            throw new Error('Expected response object');
          }

          const json = responseRecord['json'];
          if (typeof json !== 'function') {
            throw new Error('Expected json function');
          }

          json({ ok: true });
        }
      },
      params: {}
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });

    expect(result).toEqual({
      status: 200,
      body: { ok: true },
      contentType: 'application/json; charset=utf-8'
    });
  });

  it('preserves explicit content-type when handler sets it before json()', async () => {
    findRouteMock.mockReturnValue({
      definition: {
        method: 'GET',
        pattern: '/vfs/register',
        handler: (_request: unknown, response: unknown) => {
          const responseRecord = isUnknownRecord(response) ? response : null;
          if (!responseRecord) {
            throw new Error('Expected response object');
          }

          const setHeader = responseRecord['setHeader'];
          const json = responseRecord['json'];
          if (typeof setHeader !== 'function' || typeof json !== 'function') {
            throw new Error('Expected setHeader/json functions');
          }

          setHeader('content-type', 'application/custom');
          json({ ok: true });
        }
      },
      params: {}
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });

    expect(result).toEqual({
      status: 200,
      body: { ok: true },
      contentType: 'application/custom'
    });
  });

  it('preserves explicit payload passed to response.end()', async () => {
    findRouteMock.mockReturnValue({
      definition: {
        method: 'GET',
        pattern: '/vfs/register',
        handler: (_request: unknown, response: unknown) => {
          const responseRecord = isUnknownRecord(response) ? response : null;
          if (!responseRecord) {
            throw new Error('Expected response object');
          }

          const end = responseRecord['end'];
          if (typeof end !== 'function') {
            throw new Error('Expected end function');
          }

          end('done');
        }
      },
      params: {}
    });

    const result = await executeRoute({
      context: { requestHeader: createHeaders() },
      method: 'GET',
      path: '/vfs/register'
    });

    expect(result).toEqual({
      status: 200,
      body: 'done'
    });
  });
});
