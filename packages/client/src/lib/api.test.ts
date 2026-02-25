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

describe('api edge cases requiring direct fetch mocking', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = vi.fn();
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_refresh_lock');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('concurrent refresh deduplication', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('deduplicates concurrent refresh attempts via tryRefreshToken', async () => {
      localStorage.setItem('auth_refresh_token', 'refresh-token');

      let resolveRefresh: ((response: Response) => void) | undefined;
      const refreshPromise = new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL) => {
          const url = input.toString();
          if (url.endsWith('/auth/refresh')) {
            return refreshPromise;
          }
          throw new Error(`Unexpected request: ${url}`);
        }
      );

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
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });

    it('reuses refresh promise across concurrent requests hitting 401', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem('auth_refresh_token', 'refresh-token');

      let resolveRefresh: ((response: Response) => void) | undefined;
      const refreshPromise = new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input.toString();
          if (url.endsWith('/ping')) {
            const authHeader = init?.headers
              ? new Headers(init.headers).get('Authorization')
              : null;
            if (authHeader === 'Bearer new-token') {
              return new Response(JSON.stringify({ version: '1.0.0' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return new Response(null, { status: 401 });
          }

          if (url.endsWith('/auth/refresh')) {
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
        { version: '1.0.0' },
        { version: '1.0.0' }
      ]);
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.filter(([input]) =>
            input.toString().endsWith('/auth/refresh')
          )
      ).toHaveLength(1);
    });
  });

  describe('cross-tab token race detection', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('returns true when another tab refreshed token during our refresh attempt', async () => {
      localStorage.setItem('auth_refresh_token', 'old-refresh-token');

      vi.mocked(global.fetch).mockImplementationOnce(async () => {
        // Simulate another tab updating localStorage during our fetch
        localStorage.setItem(
          'auth_refresh_token',
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
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('throws 401 when refresh succeeds but token storage fails', async () => {
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.removeItem('auth_token');

      const originalSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = () => {
        throw new Error('blocked');
      };

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL) => {
          const url = input.toString();
          if (url.endsWith('/ping')) {
            return new Response(null, { status: 401 });
          }
          if (url.endsWith('/auth/refresh')) {
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
        }
      );

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
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
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
      localStorage.setItem('auth_refresh_token', expiredToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Mock refresh to fail with 401
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
    });

    it('clears auth when server rejects refresh token (401) even if JWT is not expired', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = createJwt(futureExp);
      localStorage.setItem('auth_token', 'access-token');
      localStorage.setItem('auth_refresh_token', validToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Server returns 401 because session was destroyed (e.g. DB/Redis reset)
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Refresh token has been revoked' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
    });

    it('does NOT clear auth on transient network error if token is NOT expired', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = createJwt(futureExp);
      localStorage.setItem('auth_token', 'access-token');
      localStorage.setItem('auth_refresh_token', validToken);
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Mock refresh to fail with network error
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const { tryRefreshToken } = await import('./api');
      const result = await tryRefreshToken();

      expect(result).toBe(false);
      // Auth should be preserved
      expect(localStorage.getItem('auth_token')).toBe('access-token');
      expect(localStorage.getItem('auth_refresh_token')).toBe(validToken);
    });
  });
});
