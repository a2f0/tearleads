import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
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
} from '@/lib/authStorage';
import { getSharedTestContext } from '@/test/testContext';

const loadAuthStorage = async () => {
  const module = await import('@/lib/authStorage');
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

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
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
          'http://localhost/vfs/shares/share-1',
          () => new HttpResponse(null, { status: 204 })
        )
      );

      const api = await loadApi();

      await expect(api.vfs.deleteShare('share-1')).resolves.toBeUndefined();
      expect(wasApiRequestMade('DELETE', '/vfs/shares/share-1')).toBe(true);
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
      const ctx = getSharedTestContext();
      await ctx.redis.set('sessions:abc123', 'test-session-data');

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
      await api.admin.users.get(seededUser.userId);

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_user',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade('GET', `/admin/users/${seededUser.userId}`)
      ).toBe(true);
    });
  });
});
