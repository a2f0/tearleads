import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  resolveAdminAccess,
  resolveOrganizationMembership
} from './connectRequestAuth.js';

const verifyJwtMock =
  vi.fn<
    (
      token: string,
      secret: string
    ) => { sub: string; jti: string; email?: string } | null
  >();
const getSessionMock =
  vi.fn<
    (sessionId: string) => Promise<{
      userId: string;
      email: string;
      admin: boolean;
      createdAt: string;
      lastActiveAt: string;
      ipAddress: string;
    } | null>
  >();
const updateSessionActivityMock = vi.fn<(sessionId: string) => Promise<void>>();
const getPostgresPoolMock =
  vi.fn<
    () => Promise<{
      query: (
        sql: string,
        params: unknown[]
      ) => Promise<{ rows: Array<{ organization_id: string }> }>;
    }>
  >();

vi.mock('../../lib/jwt.js', () => ({
  verifyJwt: (token: string, secret: string) => verifyJwtMock(token, secret)
}));

vi.mock('../../lib/sessions.js', () => ({
  getSession: (sessionId: string) => getSessionMock(sessionId),
  updateSessionActivity: (sessionId: string) =>
    updateSessionActivityMock(sessionId)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => getPostgresPoolMock()
}));

function createSession(userId = 'user-1', admin = false) {
  return {
    userId,
    email: `${userId}@example.com`,
    admin,
    createdAt: '2026-03-02T00:00:00.000Z',
    lastActiveAt: '2026-03-02T00:00:00.000Z',
    ipAddress: '127.0.0.1'
  };
}

describe('connectRequestAuth', () => {
  let originalJwtSecret: string | undefined;

  beforeEach(() => {
    originalJwtSecret = process.env['JWT_SECRET'];
    process.env['JWT_SECRET'] = 'jwt-secret';

    verifyJwtMock.mockReset();
    getSessionMock.mockReset();
    updateSessionActivityMock.mockReset();
    getPostgresPoolMock.mockReset();

    verifyJwtMock.mockReturnValue({
      sub: 'user-1',
      jti: 'session-1',
      email: 'user-1@example.com'
    });
    getSessionMock.mockResolvedValue(createSession('user-1', false));
    updateSessionActivityMock.mockResolvedValue();
  });

  afterEach(() => {
    if (originalJwtSecret === undefined) {
      delete process.env['JWT_SECRET'];
    } else {
      process.env['JWT_SECRET'] = originalJwtSecret;
    }
  });

  it('rejects missing or invalid bearer tokens', async () => {
    const missingAuth = await authenticate(new Headers());
    expect(missingAuth).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    const invalidPrefix = await authenticate(
      new Headers({ authorization: 'Token abc' })
    );
    expect(invalidPrefix).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    const blankBearerHeaders = new Headers();
    vi.spyOn(blankBearerHeaders, 'get').mockReturnValueOnce('Bearer   ');
    const blankBearer = await authenticate(blankBearerHeaders);
    expect(blankBearer).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });
  });

  it('rejects when JWT secret is missing or token/session validation fails', async () => {
    delete process.env['JWT_SECRET'];

    const noSecret = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );
    expect(noSecret).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to authenticate'
    });

    process.env['JWT_SECRET'] = 'jwt-secret';

    verifyJwtMock.mockReturnValueOnce(null);
    const badJwt = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );
    expect(badJwt).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    getSessionMock.mockResolvedValueOnce(null);
    const missingSession = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );
    expect(missingSession).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    getSessionMock.mockResolvedValueOnce(
      createSession('different-user', false)
    );
    const mismatchedSession = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );
    expect(mismatchedSession).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });
  });

  it('returns authenticated session data and updates activity', async () => {
    const result = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );

    expect(result).toEqual({
      ok: true,
      claims: {
        sub: 'user-1',
        jti: 'session-1',
        email: 'user-1@example.com'
      },
      session: createSession('user-1', false)
    });

    expect(verifyJwtMock).toHaveBeenCalledWith('token-1', 'jwt-secret');
    expect(getSessionMock).toHaveBeenCalledWith('session-1');
    expect(updateSessionActivityMock).toHaveBeenCalledWith('session-1');
  });

  it('returns internal auth failure when session loading throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    getSessionMock.mockRejectedValueOnce(new Error('redis down'));

    const result = await authenticate(
      new Headers({ authorization: 'Bearer token-1' })
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to authenticate'
    });

    consoleErrorSpy.mockRestore();
  });

  it('resolves organization membership for admin routes and missing headers', async () => {
    expect(
      await resolveOrganizationMembership(
        '/admin/context',
        new Headers(),
        'user-1'
      )
    ).toEqual({
      ok: true,
      organizationId: null
    });

    expect(
      await resolveOrganizationMembership(
        '/vfs/register',
        new Headers(),
        'user-1'
      )
    ).toEqual({
      ok: true,
      organizationId: null
    });
  });

  it('rejects malformed organization headers', async () => {
    const invalidChars = await resolveOrganizationMembership(
      '/vfs/register',
      new Headers({ 'x-organization-id': 'bad id' }),
      'user-1'
    );
    expect(invalidChars).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid X-Organization-Id format'
    });

    const tooLong = await resolveOrganizationMembership(
      '/vfs/register',
      new Headers({ 'x-organization-id': 'x'.repeat(101) }),
      'user-1'
    );
    expect(tooLong).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid X-Organization-Id format'
    });
  });

  it('checks organization membership in postgres', async () => {
    const queryMock =
      vi.fn<
        (
          sql: string,
          params: unknown[]
        ) => Promise<{ rows: Array<{ organization_id: string }> }>
      >();
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-1' }]
    });

    getPostgresPoolMock.mockResolvedValue({ query: queryMock });

    const missingMembership = await resolveOrganizationMembership(
      '/vfs/register',
      new Headers({ 'x-organization-id': 'org-1' }),
      'user-1'
    );
    expect(missingMembership).toEqual({
      ok: false,
      status: 403,
      error: 'Not a member of the specified organization'
    });

    const member = await resolveOrganizationMembership(
      '/vfs/register',
      new Headers({ 'x-organization-id': 'org-1' }),
      'user-1'
    );
    expect(member).toEqual({
      ok: true,
      organizationId: 'org-1'
    });
  });

  it('handles postgres membership lookup failures', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    getPostgresPoolMock.mockRejectedValueOnce(new Error('db down'));

    const result = await resolveOrganizationMembership(
      '/vfs/register',
      new Headers({ 'x-organization-id': 'org-1' }),
      'user-1'
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to verify organization membership'
    });

    consoleErrorSpy.mockRestore();
  });

  it('enforces admin session access and admin membership access', async () => {
    const nonAdminSession = createSession('user-1', false);
    const adminSession = createSession('user-1', true);

    expect(
      await resolveAdminAccess('/admin/postgres/info', nonAdminSession)
    ).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden'
    });

    expect(
      await resolveAdminAccess('/admin/postgres/info', adminSession)
    ).toEqual({
      ok: true,
      adminAccess: null
    });

    expect(await resolveAdminAccess('/vfs/register', nonAdminSession)).toEqual({
      ok: true,
      adminAccess: null
    });

    expect(await resolveAdminAccess('/admin/context', adminSession)).toEqual({
      ok: true,
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    });
  });

  it('resolves admin org access from postgres memberships', async () => {
    const queryMock =
      vi.fn<
        (
          sql: string,
          params: unknown[]
        ) => Promise<{ rows: Array<{ organization_id: string }> }>
      >();
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({
      rows: [{ organization_id: 'org-2' }, { organization_id: 'org-1' }]
    });

    getPostgresPoolMock.mockResolvedValue({ query: queryMock });

    const noAdminOrgs = await resolveAdminAccess(
      '/admin/groups',
      createSession('user-1', false)
    );
    expect(noAdminOrgs).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden'
    });

    const adminOrgs = await resolveAdminAccess(
      '/admin/groups',
      createSession('user-1', false)
    );
    expect(adminOrgs).toEqual({
      ok: true,
      adminAccess: {
        isRootAdmin: false,
        organizationIds: ['org-2', 'org-1']
      }
    });
  });

  it('handles postgres admin access failures', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    getPostgresPoolMock.mockRejectedValueOnce(new Error('db down'));

    const result = await resolveAdminAccess(
      '/admin/groups',
      createSession('user-1', false)
    );

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Failed to authorize admin access'
    });

    consoleErrorSpy.mockRestore();
  });
});
