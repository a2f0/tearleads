import { seedTestUser, type SeededUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_REFRESH_TOKEN_KEY, AUTH_TOKEN_KEY } from '@/lib/authStorage';
import { getSharedTestContext } from '@/test/testContext';

// Mock analytics to capture logged event names
const mockLogApiEvent = vi.fn();
vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

type RecordedApiRequest = ReturnType<typeof getRecordedApiRequests>[number];

const getRequestsFor = (
  method: string,
  pathname: string
): RecordedApiRequest[] =>
  getRecordedApiRequests().filter(
    (request) =>
      request.method === method.toUpperCase() && request.pathname === pathname
  );

const getRequestQuery = (request: RecordedApiRequest): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams.entries());

const expectSingleRequestQuery = (
  method: string,
  pathname: string,
  expectedQuery: Record<string, string>
): void => {
  const requests = getRequestsFor(method, pathname);
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (!request) {
    throw new Error(`Missing recorded request: ${method} ${pathname}`);
  }
  expect(getRequestQuery(request)).toEqual(expectedQuery);
};

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes auth requests through msw', async () => {
    // Login/register need server.use() overrides (require bcrypt password verification)
    server.use(
      http.post('http://localhost/auth/login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.post('http://localhost/auth/register', () =>
        HttpResponse.json({
          accessToken: 'register-access-token',
          refreshToken: 'register-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: 'new-user', email: 'new@example.com' }
        })
      )
    );

    const api = await loadApi();

    const loginResponse = await api.auth.login('user@example.com', 'password');
    const registerResponse = await api.auth.register(
      'new@example.com',
      'password'
    );
    const sessionsResponse = await api.auth.getSessions();
    const logoutResponse = await api.auth.logout();

    expect(loginResponse.accessToken).toBeTruthy();
    expect(registerResponse.refreshToken).toBeTruthy();
    expect(sessionsResponse.sessions.length).toBeGreaterThanOrEqual(1);
    expect(logoutResponse.loggedOut).toBe(true);

    expect(wasApiRequestMade('POST', '/auth/login')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/auth/sessions')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/logout')).toBe(true);
  });

  it('supports /v1-prefixed API base URLs', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost/v1');

    // Login and VFS keys need server.use() overrides
    server.use(
      http.post('http://localhost/v1/auth/login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.get('http://localhost/v1/vfs/keys/me', () =>
        HttpResponse.json({
          publicEncryptionKey: 'test-key',
          publicSigningKey: 'test-signing-key',
          encryptedPrivateKeys: 'test-enc-keys',
          argon2Salt: 'test-salt'
        })
      )
    );

    const api = await loadApi();

    await api.auth.login('user@example.com', 'password');
    await api.admin.redis.getDbSize();
    await api.vfs.getMyKeys();
    await api.ai.getUsageSummary();

    expect(wasApiRequestMade('POST', '/v1/auth/login')).toBe(true);
    expect(wasApiRequestMade('GET', '/v1/admin/redis/dbsize')).toBe(true);
    expect(wasApiRequestMade('GET', '/v1/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('GET', '/v1/ai/usage/summary')).toBe(true);
  });

  it('retries auth requests after refresh and records request order', async () => {
    const api = await loadApi();

    let sessionsAttemptCount = 0;
    let refreshPayload: unknown = null;

    server.use(
      http.get('http://localhost/auth/sessions', ({ request }) => {
        sessionsAttemptCount += 1;
        const authHeader = request.headers.get('authorization');
        if (sessionsAttemptCount === 1) {
          expect(authHeader).toBe('Bearer stale-access-token');
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
        }

        expect(authHeader).toBe('Bearer fresh-access-token');
        return HttpResponse.json({ sessions: [] });
      }),
      http.post('http://localhost/auth/refresh', async ({ request }) => {
        refreshPayload = await request.json();
        return HttpResponse.json({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token'
        });
      })
    );

    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'stale-refresh-token');

    const sessionsResponse = await api.auth.getSessions();

    expect(sessionsResponse.sessions).toEqual([]);
    expect(sessionsAttemptCount).toBe(2);
    expect(refreshPayload).toEqual({ refreshToken: 'stale-refresh-token' });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('fresh-access-token');
    expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
      'fresh-refresh-token'
    );

    expect(
      getRecordedApiRequests().map(
        (request) => `${request.method} ${request.pathname}`
      )
    ).toEqual([
      'GET /auth/sessions',
      'POST /auth/refresh',
      'GET /auth/sessions'
    ]);
  });

  it('does not attempt refresh for login 401 responses', async () => {
    const api = await loadApi();

    server.use(
      http.post('http://localhost/auth/login', () =>
        HttpResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      )
    );

    await expect(
      api.auth.login('user@example.com', 'bad-password')
    ).rejects.toThrow('Invalid email or password');

    expect(wasApiRequestMade('POST', '/auth/login')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/refresh')).toBe(false);
  });

  it('clears auth when refresh fails and refresh token is removed', async () => {
    const api = await loadApi();

    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'stale-refresh-token');

    server.use(
      http.get('http://localhost/auth/sessions', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      ),
      http.post('http://localhost/auth/refresh', () => {
        localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
      })
    );

    await expect(api.auth.getSessions()).rejects.toThrow('unauthorized');

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBeNull();

    expect(
      getRecordedApiRequests().map(
        (request) => `${request.method} ${request.pathname}`
      )
    ).toEqual(['GET /auth/sessions', 'POST /auth/refresh']);
  });

  it('deduplicates concurrent refresh attempts for parallel 401 responses', async () => {
    const api = await loadApi();

    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'stale-refresh-token');

    let sessionsRequestCount = 0;
    let refreshRequestCount = 0;
    let releaseRefreshGate: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefreshGate = resolve;
    });

    server.use(
      http.get('http://localhost/auth/sessions', () => {
        sessionsRequestCount += 1;
        if (sessionsRequestCount <= 2) {
          if (sessionsRequestCount === 2) {
            releaseRefreshGate();
          }
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
        }

        return HttpResponse.json({ sessions: [] });
      }),
      http.post('http://localhost/auth/refresh', async () => {
        refreshRequestCount += 1;
        await refreshGate;
        return HttpResponse.json({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token'
        });
      })
    );

    const [first, second] = await Promise.all([
      api.auth.getSessions(),
      api.auth.getSessions()
    ]);

    expect(first.sessions).toEqual([]);
    expect(second.sessions).toEqual([]);
    expect(refreshRequestCount).toBe(1);
    expect(sessionsRequestCount).toBe(4);
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('fresh-access-token');
    expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
      'fresh-refresh-token'
    );

    const requestSequence = getRecordedApiRequests().map(
      (request) => `${request.method} ${request.pathname}`
    );
    expect(
      requestSequence.filter((request) => request === 'POST /auth/refresh')
    ).toHaveLength(1);
  });

  it('routes admin requests through msw and preserves query/encoding', async () => {
    const ctx = getSharedTestContext();

    // Pre-populate data needed by admin endpoints
    await ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ('org 1', 'Test Org', NOW(), NOW())`
    );
    const secondUser = await seedTestUser(ctx);
    await ctx.pool.query(
      `INSERT INTO groups (id, name, organization_id, created_at, updated_at)
       VALUES ('group 1', 'Team', 'org 1', NOW(), NOW())`
    );
    await ctx.pool.query(
      `INSERT INTO user_groups (group_id, user_id, joined_at)
       VALUES ('group 1', $1, NOW())`,
      [secondUser.userId]
    );
    // Populate Redis key for getValue test
    await ctx.redis.set('user:1', 'test-value');

    const api = await loadApi();

    await api.ping.get();
    await api.admin.getContext();

    await api.admin.postgres.getInfo();
    await api.admin.postgres.getTables();
    await api.admin.postgres.getColumns('public', 'users');
    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'id',
      sortDirection: 'desc'
    });

    await api.admin.redis.getKeys('5', 2);
    await api.admin.redis.getValue('user:1');
    await api.admin.redis.deleteKey('user:1');
    await api.admin.redis.getDbSize();

    await api.admin.groups.list({ organizationId: seededUser.organizationId });
    await api.admin.groups.get('group 1');
    await api.admin.groups.create({ name: 'New Team', organizationId: 'org 1' });
    await api.admin.groups.update('group 1', { name: 'Team Updated' });
    await api.admin.groups.getMembers('group 1');
    await api.admin.groups.addMember('group 1', seededUser.userId);
    await api.admin.groups.removeMember('group 1', seededUser.userId);
    await api.admin.groups.delete('group 1');

    await api.admin.organizations.list({ organizationId: seededUser.organizationId });
    await api.admin.organizations.get('org 1');
    await api.admin.organizations.getUsers('org 1');
    await api.admin.organizations.getGroups('org 1');
    await api.admin.organizations.create({ name: 'Org Created' });
    await api.admin.organizations.update('org 1', {
      description: 'Updated Description'
    });
    await api.admin.organizations.delete('org 1');

    await api.admin.users.list({ organizationId: seededUser.organizationId });
    await api.admin.users.get(secondUser.userId);
    await api.admin.users.update(secondUser.userId, {
      emailConfirmed: true,
      admin: false
    });

    expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/context')).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/postgres/tables/public/users/columns')
    ).toBe(true);
    expect(
      wasApiRequestMade('GET', '/admin/postgres/tables/public/users/rows')
    ).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/redis/keys')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/redis/keys/user%3A1')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/admin/redis/keys/user%3A1')).toBe(
      true
    );
    expect(wasApiRequestMade('GET', '/admin/redis/dbsize')).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/groups')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/admin/groups')).toBe(true);
    expect(wasApiRequestMade('PUT', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/admin/groups/group%201')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/groups/group%201/members')).toBe(
      true
    );
    expect(wasApiRequestMade('POST', '/admin/groups/group%201/members')).toBe(
      true
    );
    expect(
      wasApiRequestMade(
        'DELETE',
        `/admin/groups/group%201/members/${seededUser.userId}`
      )
    ).toBe(true);

    expect(wasApiRequestMade('GET', '/admin/organizations')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/organizations/org%201')).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/organizations/org%201/users')).toBe(
      true
    );
    expect(
      wasApiRequestMade('GET', '/admin/organizations/org%201/groups')
    ).toBe(true);
    expect(wasApiRequestMade('POST', '/admin/organizations')).toBe(true);
    expect(wasApiRequestMade('PUT', '/admin/organizations/org%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/admin/organizations/org%201')).toBe(
      true
    );

    expect(wasApiRequestMade('GET', '/admin/users')).toBe(true);
    expect(
      wasApiRequestMade('GET', `/admin/users/${secondUser.userId}`)
    ).toBe(true);
    expect(
      wasApiRequestMade('PATCH', `/admin/users/${secondUser.userId}`)
    ).toBe(true);

    expectSingleRequestQuery('GET', '/admin/redis/keys', {
      cursor: '5',
      limit: '2'
    });
    expectSingleRequestQuery(
      'GET',
      '/admin/postgres/tables/public/users/rows',
      {
        limit: '10',
        offset: '20',
        sortColumn: 'id',
        sortDirection: 'desc'
      }
    );
  });
});
