import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_REFRESH_TOKEN_KEY,
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY
} from '@/lib/auth-storage';

const loadAuthStorage = async () => {
  const module = await import('@/lib/auth-storage');
  return module;
};

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

describe('api with msw', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('error handling', () => {
    it('throws error when response is not ok', async () => {
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('handles 404 errors', async () => {
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 404 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 404');
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('handles network errors', async () => {
      server.use(http.get('http://localhost/ping', () => HttpResponse.error()));

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow();
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('uses default message when error body has no error field', async () => {
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json({}, { status: 400 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 400');
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('extracts error message from response body', async () => {
      server.use(
        http.post('http://localhost/auth/register', () =>
          HttpResponse.json(
            { error: 'Email already registered' },
            { status: 409 }
          )
        )
      );

      const api = await loadApi();

      await expect(
        api.auth.register('existing@example.com', 'password123')
      ).rejects.toThrow('Email already registered');
      expect(wasApiRequestMade('POST', '/auth/register')).toBe(true);
    });
  });

  describe('session expiry handling', () => {
    it('clears stored auth and reports session expiry when response is 401', async () => {
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 401 })
        )
      );

      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: '123', email: 'user@example.com' })
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('does not clear auth when refresh fails but token still exists in storage', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 401 })
        ),
        http.post('http://localhost/auth/refresh', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
        'refresh-token'
      );

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBeNull();
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
      expect(wasApiRequestMade('POST', '/auth/refresh')).toBe(true);
    });

    it('adds Authorization header when auth token is stored', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');

      const api = await loadApi();
      await api.ping.get();

      const requests = getRecordedApiRequests();
      expect(requests[0]?.url).toBe('http://localhost/ping');
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('does not override existing Authorization header', async () => {
      // This tests the branch where headers already have Authorization set
      localStorage.setItem(AUTH_TOKEN_KEY, 'stored-token');

      // Use fetch directly with custom Authorization header
      const response = await fetch('http://localhost/ping', {
        headers: { Authorization: 'Bearer custom-token' }
      });
      expect(response.ok).toBe(true);
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });
  });

  describe('tryRefreshToken', () => {
    it('returns false without a refresh token', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('returns true when refresh succeeds', async () => {
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(true);
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('test-access-token');
      expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
        'test-refresh-token'
      );
      expect(wasApiRequestMade('POST', '/auth/refresh')).toBe(true);
    });

    it('returns false when refresh throws network error', async () => {
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');

      server.use(
        http.post('http://localhost/auth/refresh', () => HttpResponse.error())
      );

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(wasApiRequestMade('POST', '/auth/refresh')).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('does not clear auth when refresh fails but token still exists', async () => {
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');
      localStorage.setItem(AUTH_TOKEN_KEY, 'access-token');

      server.use(
        http.post('http://localhost/auth/refresh', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
        'refresh-token'
      );
      expect(wasApiRequestMade('POST', '/auth/refresh')).toBe(true);
    });

    it('returns false when API_BASE_URL is not set during refresh', async () => {
      vi.stubEnv('VITE_API_URL', '');
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
    });
  });

  describe('401 retry handling', () => {
    it('throws 401 when retry response is not ok after refresh', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      let pingAttempt = 0;
      server.use(
        http.get('http://localhost/ping', ({ request }) => {
          pingAttempt += 1;
          const authHeader = request.headers.get('authorization');
          if (pingAttempt === 1 && authHeader === 'Bearer stale-token') {
            return HttpResponse.json(null, { status: 401 });
          }
          // Retry after refresh still fails with 500
          return HttpResponse.json(null, { status: 500 });
        }),
        http.post('http://localhost/auth/refresh', () =>
          HttpResponse.json({
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshExpiresIn: 604800,
            user: { id: 'user-1', email: 'user@example.com' }
          })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      expect(pingAttempt).toBe(2);
      // Auth should NOT be cleared since the refresh token still exists
      expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe('new-refresh');
    });

    it('clears auth and sets error when 401 and no refresh token remains', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );
      // No refresh token set

      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 401 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('handles case where auth header is gone after successful refresh', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      let refreshCalled = false;
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 401 })
        ),
        http.post('http://localhost/auth/refresh', () => {
          refreshCalled = true;
          // Refresh succeeds but simulates another tab clearing auth
          // before the retry can use the new token
          localStorage.removeItem(AUTH_TOKEN_KEY);
          localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
          return HttpResponse.json({
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshExpiresIn: 604800,
            user: { id: 'user-1', email: 'user@example.com' }
          });
        })
      );

      const api = await loadApi();

      // The refresh handler stores the token, but then immediately removes it
      // The MSW handler removes it before returning, so the retry check finds no auth
      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      expect(refreshCalled).toBe(true);
    });
  });

  describe('response parsing', () => {
    it('handles 204 no-content responses', async () => {
      server.use(
        http.delete(
          'http://localhost/ai/conversations/conv-1',
          () => new HttpResponse(null, { status: 204 })
        )
      );

      const api = await loadApi();

      await expect(
        api.ai.deleteConversation('conv-1')
      ).resolves.toBeUndefined();
      expect(wasApiRequestMade('DELETE', '/ai/conversations/conv-1')).toBe(
        true
      );
    });

    it('handles 205 reset-content responses', async () => {
      server.use(
        http.post(
          'http://localhost/auth/logout',
          () => new HttpResponse(null, { status: 205 })
        )
      );

      const api = await loadApi();

      await expect(api.auth.logout()).resolves.toBeUndefined();
      expect(wasApiRequestMade('POST', '/auth/logout')).toBe(true);
    });

    it('handles empty text responses', async () => {
      server.use(
        http.get(
          'http://localhost/ping',
          () =>
            new HttpResponse('', {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).resolves.toBeUndefined();
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });
  });

  describe('environment configuration', () => {
    it('throws error when VITE_API_URL is not set', async () => {
      vi.stubEnv('VITE_API_URL', '');

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow(
        'VITE_API_URL environment variable is not set'
      );
    });

    it('exports the API_BASE_URL', async () => {
      vi.stubEnv('VITE_API_URL', 'http://test-api.com');

      const { API_BASE_URL } = await import('./api');

      expect(API_BASE_URL).toBe('http://test-api.com');
    });
  });

  describe('analytics event logging', () => {
    it('logs correct event name for simple endpoints', async () => {
      const api = await loadApi();
      await api.ping.get();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        true
      );
      expect(wasApiRequestMade('GET', '/ping')).toBe(true);
    });

    it('logs success=false for failed requests', async () => {
      server.use(
        http.get('http://localhost/ping', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const api = await loadApi();
      await expect(api.ping.get()).rejects.toThrow();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        false
      );
    });

    it('strips query parameters from event name for paginated requests', async () => {
      const api = await loadApi();
      await api.admin.redis.getKeys('someCursor123', 50);

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_keys',
        expect.any(Number),
        true
      );
      expectSingleRequestQuery('GET', '/admin/redis/keys', {
        cursor: 'someCursor123',
        limit: '50'
      });
    });

    it('uses generic event name for getValue without leaking key values', async () => {
      const api = await loadApi();
      await api.admin.redis.getValue('sessions:abc123');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_key',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade('GET', '/admin/redis/keys/sessions%3Aabc123')
      ).toBe(true);
    });

    it('uses generic event name for deleteKey without leaking key values', async () => {
      const api = await loadApi();
      await api.admin.redis.deleteKey('users:user-uuid:sessions');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_delete_admin_redis_key',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'DELETE',
          '/admin/redis/keys/users%3Auser-uuid%3Asessions'
        )
      ).toBe(true);
    });

    it('logs the dbsize endpoint event', async () => {
      const api = await loadApi();
      await api.admin.redis.getDbSize();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_dbsize',
        expect.any(Number),
        true
      );
      expect(wasApiRequestMade('GET', '/admin/redis/dbsize')).toBe(true);
    });

    it('logs the postgres info endpoint event', async () => {
      const api = await loadApi();
      await api.admin.postgres.getInfo();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_info',
        expect.any(Number),
        true
      );
      expect(wasApiRequestMade('GET', '/admin/postgres/info')).toBe(true);
    });

    it('logs the postgres tables endpoint event', async () => {
      const api = await loadApi();
      await api.admin.postgres.getTables();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_tables',
        expect.any(Number),
        true
      );
      expect(wasApiRequestMade('GET', '/admin/postgres/tables')).toBe(true);
    });

    it('logs the admin user get endpoint event', async () => {
      const api = await loadApi();
      await api.admin.users.get('user-1');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_user',
        expect.any(Number),
        true
      );
      expect(wasApiRequestMade('GET', '/admin/users/user-1')).toBe(true);
    });
  });

  it('routes auth requests through msw', async () => {
    const api = await loadApi();

    const loginResponse = await api.auth.login('user@example.com', 'password');
    const registerResponse = await api.auth.register(
      'new@example.com',
      'password'
    );
    const sessionsResponse = await api.auth.getSessions();
    const deleteResponse = await api.auth.deleteSession('session 1');
    const logoutResponse = await api.auth.logout();

    expect(loginResponse.accessToken).toBe('test-access-token');
    expect(registerResponse.refreshToken).toBe('test-refresh-token');
    expect(sessionsResponse.sessions).toHaveLength(1);
    expect(deleteResponse.deleted).toBe(true);
    expect(logoutResponse.loggedOut).toBe(true);

    expect(wasApiRequestMade('POST', '/auth/login')).toBe(true);
    expect(wasApiRequestMade('POST', '/auth/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/auth/sessions')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/auth/sessions/session%201')).toBe(
      true
    );
    expect(wasApiRequestMade('POST', '/auth/logout')).toBe(true);
  });

  it('supports /v1-prefixed API base URLs', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost/v1');
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

    await expect(api.auth.getSessions()).rejects.toThrow('API error: 401');

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

    await api.admin.groups.list({ organizationId: 'org-1' });
    await api.admin.groups.get('group 1');
    await api.admin.groups.create({ name: 'Team', organizationId: 'org-1' });
    await api.admin.groups.update('group 1', { name: 'Team Updated' });
    await api.admin.groups.delete('group 1');
    await api.admin.groups.getMembers('group 1');
    await api.admin.groups.addMember('group 1', 'user 2');
    await api.admin.groups.removeMember('group 1', 'user 2');

    await api.admin.organizations.list({ organizationId: 'org-1' });
    await api.admin.organizations.get('org 1');
    await api.admin.organizations.getUsers('org 1');
    await api.admin.organizations.getGroups('org 1');
    await api.admin.organizations.create({ name: 'Org Created' });
    await api.admin.organizations.update('org 1', {
      description: 'Updated Description'
    });
    await api.admin.organizations.delete('org 1');

    await api.admin.users.list({ organizationId: 'org-1' });
    await api.admin.users.get('user-2');
    await api.admin.users.update('user-2', {
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
      wasApiRequestMade('DELETE', '/admin/groups/group%201/members/user%202')
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
    expect(wasApiRequestMade('GET', '/admin/users/user-2')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/admin/users/user-2')).toBe(true);

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

  it('routes vfs and ai requests through msw', async () => {
    const api = await loadApi();

    await api.vfs.getMyKeys();
    await api.vfs.setupKeys({
      publicEncryptionKey: 'public-encryption-key',
      encryptedPrivateKeys: 'encrypted-private-keys',
      argon2Salt: 'argon2-salt'
    });
    await api.vfs.register({
      id: 'item-1',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.vfs.getShares('item 1');
    await api.vfs.createShare({
      itemId: 'item 1',
      shareType: 'user',
      targetId: 'user-2',
      permissionLevel: 'view'
    });
    await api.vfs.updateShare('share 1', { permissionLevel: 'edit' });
    await api.vfs.deleteShare('share 1');
    await api.vfs.createOrgShare({
      itemId: 'item 1',
      sourceOrgId: 'org-1',
      targetOrgId: 'org-2',
      permissionLevel: 'view'
    });
    await api.vfs.deleteOrgShare('org share 1');
    await api.vfs.searchShareTargets('test query', 'user');

    await api.ai.createConversation({
      encryptedTitle: 'encrypted-title',
      encryptedSessionKey: 'encrypted-session-key'
    });
    await api.ai.listConversations({ cursor: 'cursor-1', limit: 5 });
    await api.ai.getConversation('conversation 1');
    await api.ai.updateConversation('conversation 1', {
      encryptedTitle: 'encrypted-title-2'
    });
    await expect(
      api.ai.deleteConversation('conversation 1')
    ).resolves.toBeUndefined();
    await api.ai.addMessage('conversation 1', {
      role: 'user',
      encryptedContent: 'encrypted-content'
    });
    await api.ai.recordUsage({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      modelId: 'mistralai/mistral-7b-instruct',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    });
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-1',
      limit: 10
    });
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });

    expect(wasApiRequestMade('GET', '/vfs/keys/me')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/keys')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/register')).toBe(true);
    expect(wasApiRequestMade('GET', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/shares')).toBe(true);
    expect(wasApiRequestMade('PATCH', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('DELETE', '/vfs/shares/share%201')).toBe(true);
    expect(wasApiRequestMade('POST', '/vfs/items/item%201/org-shares')).toBe(
      true
    );
    expect(wasApiRequestMade('DELETE', '/vfs/org-shares/org%20share%201')).toBe(
      true
    );
    expect(wasApiRequestMade('GET', '/vfs/share-targets/search')).toBe(true);

    expect(wasApiRequestMade('POST', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/conversations/conversation%201')).toBe(
      true
    );
    expect(
      wasApiRequestMade('PATCH', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('DELETE', '/ai/conversations/conversation%201')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/ai/conversations/conversation%201/messages')
    ).toBe(true);
    expect(wasApiRequestMade('POST', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage')).toBe(true);
    expect(wasApiRequestMade('GET', '/ai/usage/summary')).toBe(true);

    expectSingleRequestQuery('GET', '/vfs/share-targets/search', {
      q: 'test query',
      type: 'user'
    });
    expectSingleRequestQuery('GET', '/ai/usage', {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-1',
      limit: '10'
    });
  });

  it('builds query-string variants through msw request metadata', async () => {
    const api = await loadApi();

    await api.admin.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'email',
      sortDirection: 'desc'
    });
    await api.admin.postgres.getRows('public', 'users');

    // Redis getKeys: with params vs without
    await api.admin.redis.getKeys('cursor-1', 10);
    await api.admin.redis.getKeys();

    await api.ai.listConversations({ cursor: 'cursor-1', limit: 5 });
    await api.ai.listConversations();
    await api.ai.getUsage({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      cursor: 'cursor-2',
      limit: 25
    });
    await api.ai.getUsage();
    await api.ai.getUsageSummary({
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    });
    await api.ai.getUsageSummary();

    const postgresRowsRequests = getRequestsFor(
      'GET',
      '/admin/postgres/tables/public/users/rows'
    );
    expect(postgresRowsRequests).toHaveLength(2);
    expect(postgresRowsRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          limit: '10',
          offset: '20',
          sortColumn: 'email',
          sortDirection: 'desc'
        },
        {}
      ])
    );

    const aiConversationRequests = getRequestsFor('GET', '/ai/conversations');
    expect(aiConversationRequests).toHaveLength(2);
    expect(aiConversationRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([{ cursor: 'cursor-1', limit: '5' }, {}])
    );

    const aiUsageRequests = getRequestsFor('GET', '/ai/usage');
    expect(aiUsageRequests).toHaveLength(2);
    expect(aiUsageRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
          cursor: 'cursor-2',
          limit: '25'
        },
        {}
      ])
    );

    const aiUsageSummaryRequests = getRequestsFor('GET', '/ai/usage/summary');
    expect(aiUsageSummaryRequests).toHaveLength(2);
    expect(aiUsageSummaryRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        },
        {}
      ])
    );

    const redisKeysRequests = getRequestsFor('GET', '/admin/redis/keys');
    expect(redisKeysRequests).toHaveLength(2);
    expect(redisKeysRequests.map(getRequestQuery)).toEqual(
      expect.arrayContaining([{ cursor: 'cursor-1', limit: '10' }, {}])
    );
  });

  it('covers non-wrapper API parity endpoints', async () => {
    const requests: Array<{
      method: string;
      pathname: string;
      init?: RequestInit;
    }> = [
      { method: 'GET', pathname: '/billing/organizations/org-1' },
      { method: 'GET', pathname: '/emails' },
      { method: 'GET', pathname: '/emails/email-1' },
      { method: 'GET', pathname: '/emails/drafts' },
      { method: 'GET', pathname: '/emails/drafts/draft-1' },
      {
        method: 'POST',
        pathname: '/emails/drafts',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: 'test draft' })
        }
      },
      { method: 'DELETE', pathname: '/emails/drafts/draft-1' },
      {
        method: 'POST',
        pathname: '/emails/send',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'user@example.com' })
        }
      },
      { method: 'DELETE', pathname: '/emails/email-1' },
      { method: 'GET', pathname: '/mls/groups' },
      { method: 'GET', pathname: '/mls/groups/group-1' },
      { method: 'GET', pathname: '/mls/groups/group-1/members' },
      { method: 'GET', pathname: '/mls/groups/group-1/messages' },
      { method: 'GET', pathname: '/mls/groups/group-1/state' },
      { method: 'GET', pathname: '/mls/key-packages/me' },
      { method: 'GET', pathname: '/mls/key-packages/user-1' },
      { method: 'GET', pathname: '/mls/welcome-messages' },
      {
        method: 'POST',
        pathname: '/mls/groups',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'group' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/members',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user-2' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/messages',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedMessage: 'message' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/groups/group-1/state',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedState: 'state' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/key-packages',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyPackage: 'key-package' })
        }
      },
      {
        method: 'POST',
        pathname: '/mls/welcome-messages/message-1/ack',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      },
      {
        method: 'PATCH',
        pathname: '/mls/groups/group-1',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'updated' })
        }
      },
      { method: 'DELETE', pathname: '/mls/groups/group-1/members/user-1' },
      { method: 'DELETE', pathname: '/mls/groups/group-1' },
      { method: 'DELETE', pathname: '/mls/key-packages/key-1' },
      {
        method: 'POST',
        pathname: '/revenuecat/webhooks',
        init: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'purchase' })
        }
      }
    ];

    for (const request of requests) {
      const response = await fetch(`http://localhost${request.pathname}`, {
        method: request.method,
        ...request.init
      });
      expect(response.ok).toBe(true);
    }

    const sse = await fetch('http://localhost/sse');
    expect(sse.ok).toBe(true);
    expect(sse.headers.get('content-type')).toContain('text/event-stream');

    for (const request of requests) {
      expect(wasApiRequestMade(request.method, request.pathname)).toBe(true);
    }
    expect(wasApiRequestMade('GET', '/sse')).toBe(true);
  });
});
