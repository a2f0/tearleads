import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import {
  buildAdminV2ConnectMethodPath,
  buildAuthV2ConnectMethodPath,
  buildVfsSharesV2ConnectMethodPath
} from '@tearleads/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiCoreRuntimeForTesting } from './apiCore';
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  resetAuthStorageRuntimeForTesting
} from './authStorage';
import { installApiV2WasmBindingsOverride } from './test/apiV2WasmBindingsTestOverride';
import { setTestEnv } from './test/env.js';
import { getSharedTestContext } from './test/testContext';

vi.mock('./pingWasmImport');

const loadAuthStorage = async () => {
  const module = await import('./authStorage');
  return module;
};

const mockLogApiEvent = vi.fn();

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

let seededUser: SeededUser;

describe('api with msw', () => {
  beforeEach(async () => {
    resetAuthStorageRuntimeForTesting();
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    resetApiCoreRuntimeForTesting();
    localStorage.clear();
    installApiV2WasmBindingsOverride();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    (await import('./authStorage')).setStoredAuthToken(seededUser.accessToken);
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger((...args: Parameters<typeof mockLogApiEvent>) =>
      mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
  });

  describe('401 retry handling', () => {
    it('throws 401 when retry response is not ok after refresh', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      (await import('./authStorage')).setStoredRefreshToken('refresh-token');
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
          `http://localhost${buildAuthV2ConnectMethodPath('RefreshToken')}`,
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
      (await import('./authStorage')).setStoredRefreshToken('refresh-token');
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
          `http://localhost${buildAuthV2ConnectMethodPath('RefreshToken')}`,
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
      const { setApiRequestHeadersProvider, resetApiRequestHeadersProvider } =
        await import('./apiCore');
      setApiRequestHeadersProvider(() => ({
        'X-Organization-Id': seededUser.organizationId
      }));

      try {
        server.use(
          http.post(
            `http://localhost${buildVfsSharesV2ConnectMethodPath('DeleteShare')}`,
            () => new HttpResponse(null, { status: 204 })
          )
        );

        const api = await loadApi();

        await expect(api.vfs.deleteShare('share-1')).resolves.toEqual({});
        expect(
          wasApiRequestMade(
            'POST',
            buildVfsSharesV2ConnectMethodPath('DeleteShare')
          )
        ).toBe(true);
      } finally {
        resetApiRequestHeadersProvider();
      }
    });

    it('handles 205 reset-content responses', async () => {
      server.use(
        http.post(
          `http://localhost${buildAuthV2ConnectMethodPath('Logout')}`,
          () => new HttpResponse(null, { status: 205 })
        )
      );

      const api = await loadApi();

      await expect(api.auth.logout()).resolves.toBeUndefined();
      expect(
        wasApiRequestMade('POST', buildAuthV2ConnectMethodPath('Logout'))
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
      setTestEnv('VITE_API_URL', '');
      resetApiCoreRuntimeForTesting();

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow(
        'VITE_API_URL environment variable is not set'
      );
    });

    it('exports the API_BASE_URL', async () => {
      setTestEnv('VITE_API_URL', 'http://test-api.com');
      resetApiCoreRuntimeForTesting();

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
      await api.adminV2.redis.getKeys('someCursor123', 50);

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_keys',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetRedisKeys'))
      ).toBe(true);
    });

    it('uses generic event name for getValue without leaking key values', async () => {
      const ctx = getSharedTestContext();
      await ctx.redis.set('sessions:abc123', 'test-session-data');

      const api = await loadApi();
      await api.adminV2.redis.getValue('sessions:abc123');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_key',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          buildAdminV2ConnectMethodPath('GetRedisValue')
        )
      ).toBe(true);
    });

    it('uses generic event name for deleteKey without leaking key values', async () => {
      const api = await loadApi();
      await api.adminV2.redis.deleteKey('users:user-uuid:sessions');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_delete_admin_redis_key',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          buildAdminV2ConnectMethodPath('DeleteRedisKey')
        )
      ).toBe(true);
    });

    it('logs the dbsize endpoint event', async () => {
      const api = await loadApi();
      await api.adminV2.redis.getDbSize();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_dbsize',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          buildAdminV2ConnectMethodPath('GetRedisDbSize')
        )
      ).toBe(true);
    });

    it('logs the postgres info endpoint event', async () => {
      const api = await loadApi();
      await api.adminV2.postgres.getInfo();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_info',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade(
          'POST',
          buildAdminV2ConnectMethodPath('GetPostgresInfo')
        )
      ).toBe(true);
    });

    it('logs the postgres tables endpoint event', async () => {
      const api = await loadApi();
      await api.adminV2.postgres.getTables();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_tables',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetTables'))
      ).toBe(true);
    });

    it('logs the admin user get endpoint event', async () => {
      const api = await loadApi();
      await api.adminV2.users.get('user-1');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_user',
        expect.any(Number),
        true
      );
      expect(
        wasApiRequestMade('POST', buildAdminV2ConnectMethodPath('GetUser'))
      ).toBe(true);
    });
  });
});
