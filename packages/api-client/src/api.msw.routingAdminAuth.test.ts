import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_REFRESH_TOKEN_KEY, AUTH_TOKEN_KEY } from './authStorage';
import { getSharedTestContext } from './test/testContext';
const mockLogApiEvent = vi.fn();
const loadApi = async () => {
  const module = await import('./api');
  return module.api;
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
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });
  it('routes auth requests through msw', async () => {
    // Login/register need server.use() overrides (require bcrypt password verification)
    server.use(
      http.post('http://localhost/connect/tearleads.v1.AuthService/Login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.post('http://localhost/connect/tearleads.v1.AuthService/Register', () =>
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
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/Login')).toBe(true);
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/Register')).toBe(true);
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/GetSessions')).toBe(true);
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/Logout')).toBe(true);
  });
  it('supports /v1-prefixed API base URLs', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost/v1');
    // Login and VFS keys need server.use() overrides
    server.use(
      http.post('http://localhost/v1/connect/tearleads.v1.AuthService/Login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.post('http://localhost/v1/connect/tearleads.v1.VfsService/GetMyKeys', () =>
        HttpResponse.json({
          json: JSON.stringify({
            publicEncryptionKey: 'test-key',
            publicSigningKey: 'test-signing-key',
            encryptedPrivateKeys: 'test-enc-keys',
            argon2Salt: 'test-salt'
          })
        })
      )
    );
    const api = await loadApi();
    await api.auth.login('user@example.com', 'password');
    await api.admin.redis.getDbSize();
    await api.vfs.getMyKeys();
    await api.ai.getUsageSummary();
    expect(wasApiRequestMade('POST', '/v1/connect/tearleads.v1.AuthService/Login')).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/v1/connect/tearleads.v1.AdminService/GetRedisDbSize'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/v1/connect/tearleads.v1.VfsService/GetMyKeys')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/v1/connect/tearleads.v1.AiService/GetUsageSummary'
      )
    ).toBe(true);
  });
  it('retries auth requests after refresh and records request order', async () => {
    const api = await loadApi();
    let sessionsAttemptCount = 0;
    let refreshPayload: unknown = null;
    server.use(
      http.post('http://localhost/connect/tearleads.v1.AuthService/GetSessions', ({ request }) => {
        sessionsAttemptCount += 1;
        const authHeader = request.headers.get('authorization');
        if (sessionsAttemptCount === 1) {
          expect(authHeader).toBe('Bearer stale-access-token');
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        expect(authHeader).toBe('Bearer fresh-access-token');
        return HttpResponse.json({ sessions: [] });
      }),
      http.post('http://localhost/connect/tearleads.v1.AuthService/RefreshToken', async ({ request }) => {
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
      'POST /connect/tearleads.v1.AuthService/GetSessions',
      'POST /connect/tearleads.v1.AuthService/RefreshToken',
      'POST /connect/tearleads.v1.AuthService/GetSessions'
    ]);
  });
  it('does not attempt refresh for login 401 responses', async () => {
    const api = await loadApi();
    server.use(
      http.post('http://localhost/connect/tearleads.v1.AuthService/Login', () =>
        HttpResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      )
    );
    await expect(
      api.auth.login('user@example.com', 'bad-password')
    ).rejects.toThrow('Invalid email or password');
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/Login')).toBe(true);
    expect(wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/RefreshToken')).toBe(false);
  });
  it('clears auth when refresh fails and refresh token is removed', async () => {
    const api = await loadApi();
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'stale-refresh-token');
    server.use(
      http.post('http://localhost/connect/tearleads.v1.AuthService/GetSessions', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      ),
      http.post('http://localhost/connect/tearleads.v1.AuthService/RefreshToken', () => {
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
    ).toEqual(['POST /connect/tearleads.v1.AuthService/GetSessions', 'POST /connect/tearleads.v1.AuthService/RefreshToken']);
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
      http.post('http://localhost/connect/tearleads.v1.AuthService/GetSessions', () => {
        sessionsRequestCount += 1;
        if (sessionsRequestCount <= 2) {
          if (sessionsRequestCount === 2) {
            releaseRefreshGate();
          }
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
        return HttpResponse.json({ sessions: [] });
      }),
      http.post('http://localhost/connect/tearleads.v1.AuthService/RefreshToken', async () => {
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
      requestSequence.filter((request) => request === 'POST /connect/tearleads.v1.AuthService/RefreshToken')
    ).toHaveLength(1);
  });
  it('routes admin requests through msw and preserves query/encoding', async () => {
    const ctx = getSharedTestContext();
    // Pre-populate data needed by admin endpoints
    // Create org, group, and secondary user for admin CRUD tests
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
    await api.admin.groups.create({
      name: 'New Team',
      organizationId: 'org 1'
    });
    await api.admin.groups.update('group 1', { name: 'Team Updated' });
    await api.admin.groups.getMembers('group 1');
    await api.admin.groups.addMember('group 1', seededUser.userId);
    await api.admin.groups.removeMember('group 1', seededUser.userId);
    await api.admin.groups.delete('group 1');
    await api.admin.organizations.list({
      organizationId: seededUser.organizationId
    });
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
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetContext')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetPostgresInfo'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetTables')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetColumns')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetRows')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisKeys'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisValue'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/DeleteRedisKey'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetRedisDbSize'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/ListGroups'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetGroup')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/CreateGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/UpdateGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/DeleteGroup'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetGroupMembers'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/AddGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/RemoveGroupMember'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/ListOrganizations'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetOrgUsers'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/GetOrgGroups'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/CreateOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/UpdateOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v1.AdminService/DeleteOrganization'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/ListUsers')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetUser')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/UpdateUser')
    ).toBe(true);
  });
});
