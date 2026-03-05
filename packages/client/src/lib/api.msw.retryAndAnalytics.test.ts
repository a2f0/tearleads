import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/lib/authStorage';
import {
  installApiV2WasmBindingsTestOverride,
  removeApiV2WasmBindingsTestOverride
} from '@/test/apiV2WasmBindingsTestOverride';
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

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mockedPingWasmModule = {
      v2_ping_path: () => '/v2/ping',
      parse_v2_ping_value: (payload: unknown) => {
        if (typeof payload !== 'object' || payload === null) {
          throw new Error('Invalid v2 ping response payload');
        }
        return payload;
      }
    };
    vi.doMock('./pingWasmImport', () => ({
      importPingWasmModule: () => Promise.resolve(mockedPingWasmModule)
    }));
    Reflect.set(globalThis, '__tearleadsImportPingWasmModule', () =>
      Promise.resolve(mockedPingWasmModule)
    );
    installApiV2WasmBindingsTestOverride();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    localStorage.setItem(AUTH_TOKEN_KEY, seededUser.accessToken);
    const { setActiveOrganizationId } = await import('@/lib/orgStorage');
    setActiveOrganizationId(seededUser.organizationId);
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    Reflect.deleteProperty(globalThis, '__tearleadsImportPingWasmModule');
    removeApiV2WasmBindingsTestOverride();
    const { clearActiveOrganizationId } = await import('@/lib/orgStorage');
    clearActiveOrganizationId();
    vi.unstubAllEnvs();
  });

  describe('401 retry handling', () => {
    it('throws 401 when retry response is not ok after refresh', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        'refresh-token'
      );
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      let pingAttempt = 0;
      server.use(
        http.get('http://localhost/v2/ping', ({ request }) => {
          pingAttempt += 1;
          const authHeader = request.headers.get('authorization');
          if (pingAttempt === 1 && authHeader === 'Bearer stale-token') {
            return HttpResponse.json(null, { status: 401 });
          }
          // Retry after refresh still fails with 500
          return HttpResponse.json(null, { status: 500 });
        }),
        http.post(
          'http://localhost/connect/tearleads.v1.AuthService/RefreshToken',
          () =>
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
      const { getStoredRefreshToken } = await loadAuthStorage();
      expect(getStoredRefreshToken()).toBe('new-refresh');
    });

    it('clears auth and sets error when 401 and no refresh token remains', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );
      // No refresh token set

      server.use(
        http.get('http://localhost/v2/ping', () =>
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
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        'refresh-token'
      );
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      let refreshCalled = false;
      server.use(
        http.get('http://localhost/v2/ping', () =>
          HttpResponse.json(null, { status: 401 })
        ),
        http.post(
          'http://localhost/connect/tearleads.v1.AuthService/RefreshToken',
          () => {
            refreshCalled = true;
            // Refresh succeeds but simulates another tab clearing auth
            // before the retry can use the new token
            localStorage.removeItem(AUTH_TOKEN_KEY);
            return HttpResponse.json({
              accessToken: 'new-token',
              refreshToken: 'new-refresh',
              tokenType: 'Bearer',
              expiresIn: 3600,
              refreshExpiresIn: 604800,
              user: { id: 'user-1', email: 'user@example.com' }
            });
          }
        )
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
        http.post(
          'http://localhost/connect/tearleads.v1.VfsSharesService/DeleteShare',
          () => new HttpResponse(null, { status: 204 })
        )
      );

      const api = await loadApi();

      await expect(api.vfs.deleteShare('share-1')).resolves.toEqual({});
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v1.VfsSharesService/DeleteShare'
        )
      ).toBe(true);
    });

    it('handles 205 reset-content responses', async () => {
      server.use(
        http.post(
          'http://localhost/connect/tearleads.v1.AuthService/Logout',
          () => new HttpResponse(null, { status: 205 })
        )
      );

      const api = await loadApi();

      await expect(api.auth.logout()).resolves.toBeUndefined();
      expect(
        wasApiRequestMade('POST', '/connect/tearleads.v1.AuthService/Logout')
      ).toBe(true);
    });

    it('handles empty text responses', async () => {
      server.use(
        http.get(
          'http://localhost/v2/ping',
          () =>
            new HttpResponse('', {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow(
        'Invalid v2 ping response payload'
      );
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
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

    it('loads api module with analytics logger wiring', async () => {
      const moduleLogApiEvent = vi.fn(async () => undefined);
      vi.doMock('@/db/analytics', () => ({
        logApiEvent: moduleLogApiEvent
      }));

      try {
        const { API_BASE_URL } = await import('./api');
        expect(API_BASE_URL).toBe('http://localhost');
      } finally {
        vi.doMock('@/db/analytics', () => ({
          logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
        }));
      }
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
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('logs success=false for failed requests', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () =>
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
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AdminService/GetRedisKeys'
        )
      ).toBe(true);
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
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AdminService/GetRedisValue'
        )
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
          'POST',
          '/connect/tearleads.v2.AdminService/DeleteRedisKey'
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
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AdminService/GetRedisDbSize'
        )
      ).toBe(true);
    });

    it('logs the postgres info endpoint event', async () => {
      const api = await loadApi();
      await api.admin.postgres.getInfo();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_info',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AdminService/GetPostgresInfo'
        )
      ).toBe(true);
    });

    it('logs the postgres tables endpoint event', async () => {
      const api = await loadApi();
      await api.admin.postgres.getTables();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_tables',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AdminService/GetTables'
        )
      ).toBe(true);
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
        wasApiRequestMade('POST', '/connect/tearleads.v1.AdminService/GetUser')
      ).toBe(true);
    });
  });
});
