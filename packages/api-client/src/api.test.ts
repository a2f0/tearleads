/**
 * Tests requiring direct fetch mocking for precise timing/coordination control.
 * These cannot be migrated to MSW because they need:
 * - Manual Promise gates to control when requests complete
 * - Mid-request localStorage mutations to simulate cross-tab races
 * - localStorage.setItem injection to test storage failures
 *
 * All other API tests have been consolidated into api.msw.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiCoreRuntimeForTesting } from './apiCore';
import { resetAuthStorageRuntimeForTesting } from './authStorage';
import { AUTH_V2_REFRESH_CONNECT_PATH } from './connectRoutes';
import { setTestEnv } from './test/env.js';

vi.mock('./pingWasmImport', () => ({
  importPingWasmModule: () =>
    Promise.resolve({
      v2_ping_path: () => '/v2/ping',
      parse_v2_ping_value: (payload: unknown) => {
        if (typeof payload !== 'object' || payload === null) {
          throw new Error('Invalid v2 ping response payload');
        }
        return payload;
      }
    })
}));

describe('api edge cases requiring direct fetch mocking', () => {
  const originalFetch = global.fetch;
  let fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStorageRuntimeForTesting();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_refresh_lock');
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    const { resetApiRequestHeadersProvider } = await import('./api');
    resetApiRequestHeadersProvider();
  });

  describe('concurrent refresh deduplication', () => {
    beforeEach(() => {
      setTestEnv('VITE_API_URL', 'http://localhost:3000');
      resetApiCoreRuntimeForTesting();
    });

    it('deduplicates concurrent refresh attempts via tryRefreshToken', async () => {
      (await import('./authStorage')).setStoredRefreshToken('refresh-token');

      let resolveRefresh: ((response: Response) => void) | undefined;
      const refreshPromise = new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith(AUTH_V2_REFRESH_CONNECT_PATH)) {
          return refreshPromise;
        }
        throw new Error(`Unexpected request: ${url}`);
      });

      const { tryRefreshToken } = await import('./api');

      const first = tryRefreshToken();
      const second = tryRefreshToken();

      if (!resolveRefresh) {
        throw new Error('refresh resolver missing');
      }

      resolveRefresh(
        new Response(
          JSON.stringify({
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshExpiresIn: 604800,
            user: { id: 'user-1', email: 'user@example.com' }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reuses refresh promise across concurrent requests hitting 401', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      (await import('./authStorage')).setStoredRefreshToken('refresh-token');

      let resolveRefresh: ((response: Response) => void) | undefined;
      const refreshPromise = new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });

      fetchMock.mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input.toString();
          if (url.endsWith('/v2/ping')) {
            const authHeader = init?.headers
              ? new Headers(init.headers).get('Authorization')
              : null;
            if (authHeader === 'Bearer new-token') {
              return new Response(
                JSON.stringify({
                  status: 'ok',
                  service: 'api-v2',
                  version: '1.0.0'
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            }
            return new Response(null, { status: 401 });
          }

          if (url.endsWith(AUTH_V2_REFRESH_CONNECT_PATH)) {
            return refreshPromise;
          }

          throw new Error(`Unexpected request: ${url}`);
        }
      );

      const { api } = await import('./api');

      const first = api.ping.get();
      const second = api.ping.get();

      if (!resolveRefresh) {
        throw new Error('refresh resolver missing');
      }

      resolveRefresh(
        new Response(
          JSON.stringify({
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshExpiresIn: 604800,
            user: { id: 'user-1', email: 'user@example.com' }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      await expect(Promise.all([first, second])).resolves.toEqual([
        { status: 'ok', service: 'api-v2', version: '1.0.0' },
        { status: 'ok', service: 'api-v2', version: '1.0.0' }
      ]);
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.filter(([input]) =>
            input.toString().endsWith(AUTH_V2_REFRESH_CONNECT_PATH)
          )
      ).toHaveLength(1);
    });
  });

  describe('cross-tab token race detection', () => {
    beforeEach(() => {
      setTestEnv('VITE_API_URL', 'http://localhost:3000');
      resetApiCoreRuntimeForTesting();
    });

    it('returns true when another tab refreshed token during our refresh attempt', async () => {
      (await import('./authStorage')).setStoredRefreshToken(
        'old-refresh-token'
      );

      fetchMock.mockImplementationOnce(async () => {
        // Simulate another tab updating localStorage during our fetch
        (await import('./authStorage')).setStoredRefreshToken(
          'new-refresh-from-other-tab'
        );
        localStorage.setItem('auth_token', 'new-token-from-other-tab');
        // Our refresh fails because old token was already rotated
        return new Response(null, { status: 401 });
      });

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      // Should detect that another tab updated the token and return true
      expect(result).toBe(true);
    });
  });

  describe('storage failure handling', () => {
    beforeEach(() => {
      setTestEnv('VITE_API_URL', 'http://localhost:3000');
      resetApiCoreRuntimeForTesting();
    });

    it('throws 401 when refresh succeeds but token storage fails', async () => {
      (await import('./authStorage')).setStoredRefreshToken('refresh-token');
      localStorage.removeItem('auth_token');

      const originalSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = () => {
        throw new Error('blocked');
      };

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith('/v2/ping')) {
          return new Response(null, { status: 401 });
        }
        if (url.endsWith(AUTH_V2_REFRESH_CONNECT_PATH)) {
          return new Response(
            JSON.stringify({
              accessToken: 'new-token',
              refreshToken: 'new-refresh',
              tokenType: 'Bearer',
              expiresIn: 3600,
              refreshExpiresIn: 604800,
              user: { id: 'user-1', email: 'user@example.com' }
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      });

      try {
        const { api } = await import('./api');
        const { getAuthError } = await import('./authStorage');

        // Request fails because we can't store the new token
        await expect(api.ping.get()).rejects.toThrow('API error: 401');
        // Auth error is NOT set because there's still a refresh token in storage
        // (indicates another tab might succeed with the stored token)
        expect(getAuthError()).toBeNull();
      } finally {
        localStorage.setItem = originalSetItem;
      }
    });
  });

  describe('refresh failure and session expiration', () => {
    beforeEach(() => {
      setTestEnv('VITE_API_URL', 'http://localhost:3000');
      resetApiCoreRuntimeForTesting();
    });

    function createJwt(expiresAtSeconds: number): string {
      const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      const payload = btoa(JSON.stringify({ exp: expiresAtSeconds }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      return `${header}.${payload}.`;
    }

    it('clears auth when refresh fails and token is expired (not a transient error)', async () => {
      // Setup initial state with an expired token
      const expiredToken = 'expired-token';
      localStorage.setItem('auth_token', 'access-token');
      (await import('./authStorage')).setStoredRefreshToken(expiredToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Mock refresh to fail with 401
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(
        (await import('./authStorage')).getStoredRefreshToken()
      ).toBeNull();
    });

    it('clears auth when server rejects refresh token (401) even if JWT is not expired', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = createJwt(futureExp);
      localStorage.setItem('auth_token', 'access-token');
      (await import('./authStorage')).setStoredRefreshToken(validToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Server returns 401 because session was destroyed (e.g. DB/Redis reset)
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Refresh token has been revoked' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(
        (await import('./authStorage')).getStoredRefreshToken()
      ).toBeNull();
    });

    it('does NOT clear auth on transient network error if token is NOT expired', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = createJwt(futureExp);
      localStorage.setItem('auth_token', 'access-token');
      (await import('./authStorage')).setStoredRefreshToken(validToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Mock refresh to fail with network error
      fetchMock.mockRejectedValue(new Error('Network error'));

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      // Auth should be preserved
      expect(localStorage.getItem('auth_token')).toBe('access-token');
      expect((await import('./authStorage')).getStoredRefreshToken()).toBe(
        validToken
      );
    });
  });
});
