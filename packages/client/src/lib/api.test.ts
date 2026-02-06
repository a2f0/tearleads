import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock import.meta.env before importing the module
const mockEnv: { VITE_API_URL?: string } = {};

vi.mock('import.meta', () => ({
  env: mockEnv
}));

// Mock analytics to capture logged event names
const mockLogApiEvent = vi.fn();
vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

// We need to re-import after mocking
describe('api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = vi.fn();
    mockLogApiEvent.mockResolvedValue(undefined);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('auth_user');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('when API_BASE_URL is set', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('makes a request to the correct endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ version: '1.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      const result = await api.ping.get();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        {}
      );
      expect(result).toEqual({ version: '1.0.0' });
    });

    it('throws error when response is not ok', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
    });

    it('handles 404 errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 404 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 404');
    });

    it('clears stored auth and reports session expiry when response is 401', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 401 })
      );

      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: '123', email: 'user@example.com' })
      );

      const { api } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(api.ping.get()).rejects.toThrow('API error: 401');

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('does not trigger session expired error on login 401 (invalid credentials)', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid email or password' }), {
          status: 401
        })
      );

      const { api } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(
        api.auth.login('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid email or password');

      // Should NOT set session expired error for login failures
      expect(getAuthError()).toBeNull();
    });

    it('registers a new user', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
            tokenType: 'Bearer',
            expiresIn: 3600,
            refreshExpiresIn: 604800,
            user: { id: 'user-1', email: 'new@example.com' }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      const result = await api.auth.register('new@example.com', 'password123');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'new@example.com',
            password: 'password123'
          })
        })
      );
      expect(result).toEqual({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshExpiresIn: 604800,
        user: { id: 'user-1', email: 'new@example.com' }
      });
    });

    it('does not trigger session expired error on register 401', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 401
        })
      );

      const { api } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(
        api.auth.register('test@example.com', 'password123')
      ).rejects.toThrow('Invalid request');

      // Should NOT set session expired error for registration failures
      expect(getAuthError()).toBeNull();
    });

    it('throws error with message from response body when email already registered', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Email already registered' }), {
          status: 409
        })
      );

      const { api } = await import('./api');

      await expect(
        api.auth.register('existing@example.com', 'password123')
      ).rejects.toThrow('Email already registered');
    });

    it('extracts error message from login 401 response', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid email or password' }), {
          status: 401
        })
      );

      const { api } = await import('./api');

      await expect(
        api.auth.login('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid email or password');
    });

    it('handles network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('Network error');
    });

    it('uses default message when error body has no error field', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({}), { status: 400 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 400');
    });

    it('deduplicates concurrent refresh attempts', async () => {
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

    it('refreshes token and retries request on 401', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem('auth_refresh_token', 'refresh-token');

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input.toString();
          if (url.endsWith('/ping')) {
            const authHeader = init?.headers
              ? new Headers(init.headers).get('Authorization')
              : null;
            if (authHeader === 'Bearer stale-token') {
              return new Response(null, { status: 401 });
            }
            return new Response(JSON.stringify({ version: '1.0.0' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
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

      const { api } = await import('./api');
      const result = await api.ping.get();

      expect(result).toEqual({ version: '1.0.0' });
      expect(localStorage.getItem('auth_token')).toBe('new-token');
      expect(localStorage.getItem('auth_refresh_token')).toBe('new-refresh');
      expect(vi.mocked(global.fetch).mock.calls).toHaveLength(3);
    });

    it('reuses refresh promise across concurrent requests', async () => {
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

    it('clears auth when retry response is not ok after refresh', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = input.toString();
          if (url.endsWith('/ping')) {
            const authHeader = init?.headers
              ? new Headers(init.headers).get('Authorization')
              : null;
            if (authHeader === 'Bearer new-token') {
              return new Response(null, { status: 500 });
            }
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

      const { api } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(api.ping.get()).rejects.toThrow('API error: 401');

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('clears auth when refresh succeeds but no auth header is available', async () => {
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
        const { getAuthError } = await import('./auth-storage');

        await expect(api.ping.get()).rejects.toThrow('API error: 401');
        expect(getAuthError()).toBe('Session expired. Please sign in again.');
      } finally {
        localStorage.setItem = originalSetItem;
      }
    });

    it('clears auth when refresh fails after 401', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      vi.mocked(global.fetch).mockImplementation(
        async (input: RequestInfo | URL) => {
          const url = input.toString();
          if (url.endsWith('/ping')) {
            return new Response(null, { status: 401 });
          }
          if (url.endsWith('/auth/refresh')) {
            return new Response(null, { status: 500 });
          }
          throw new Error(`Unexpected request: ${url}`);
        }
      );

      const { api } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(api.ping.get()).rejects.toThrow('API error: 401');

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_refresh_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('tryRefreshToken returns false without a refresh token', async () => {
      localStorage.setItem('auth_token', 'stale-token');
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      const { tryRefreshToken } = await import('./api');
      const { getAuthError } = await import('./auth-storage');

      await expect(tryRefreshToken()).resolves.toBe(false);

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
    });

    it('tryRefreshToken returns true when refresh succeeds', async () => {
      localStorage.setItem('auth_refresh_token', 'refresh-token');

      vi.mocked(global.fetch).mockResolvedValueOnce(
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

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(true);
      expect(localStorage.getItem('auth_token')).toBe('new-token');
      expect(localStorage.getItem('auth_refresh_token')).toBe('new-refresh');
    });

    it('builds postgres rows query strings from options', async () => {
      vi.mocked(global.fetch).mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );

      const { api } = await import('./api');

      await api.admin.postgres.getRows('public', 'users', {
        limit: 10,
        offset: 20,
        sortColumn: 'email',
        sortDirection: 'desc'
      });
      await api.admin.postgres.getRows('public', 'users');

      expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
        'http://localhost:3000/admin/postgres/tables/public/users/rows?limit=10&offset=20&sortColumn=email&sortDirection=desc'
      );
      expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toBe(
        'http://localhost:3000/admin/postgres/tables/public/users/rows'
      );
    });

    it('builds AI usage query strings from options', async () => {
      vi.mocked(global.fetch).mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );

      const { api } = await import('./api');

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

      expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
        'http://localhost:3000/ai/conversations?cursor=cursor-1&limit=5'
      );
      expect(vi.mocked(global.fetch).mock.calls[1]?.[0]).toBe(
        'http://localhost:3000/ai/conversations'
      );
      expect(vi.mocked(global.fetch).mock.calls[2]?.[0]).toBe(
        'http://localhost:3000/ai/usage?startDate=2024-01-01&endDate=2024-01-31&cursor=cursor-2&limit=25'
      );
      expect(vi.mocked(global.fetch).mock.calls[3]?.[0]).toBe(
        'http://localhost:3000/ai/usage'
      );
      expect(vi.mocked(global.fetch).mock.calls[4]?.[0]).toBe(
        'http://localhost:3000/ai/usage/summary?startDate=2024-01-01&endDate=2024-01-31'
      );
      expect(vi.mocked(global.fetch).mock.calls[5]?.[0]).toBe(
        'http://localhost:3000/ai/usage/summary'
      );
    });

    it('adds Authorization header when auth token is stored', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ version: '1.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
      localStorage.setItem('auth_token', 'test-token');

      const { api } = await import('./api');
      await api.ping.get();

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }

      const options = call[1];
      const headers = new Headers(options?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      localStorage.removeItem('auth_token');
    });
  });

  describe('when API_BASE_URL is not set', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', '');
    });

    it('throws error when VITE_API_URL is not set', async () => {
      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow(
        'VITE_API_URL environment variable is not set'
      );
    });
  });

  describe('API_BASE_URL export', () => {
    it('exports the API_BASE_URL', async () => {
      vi.stubEnv('VITE_API_URL', 'http://test-api.com');

      const { API_BASE_URL } = await import('./api');

      expect(API_BASE_URL).toBe('http://test-api.com');
    });
  });

  describe('event name generation', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('strips query parameters from event name for paginated requests', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ keys: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getKeys('someCursor123', 50);

      // Event name should be api_get_admin_redis_keys, not api_get_admin_redis_keys?cursor=someCursor123&limit=50
      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_keys',
        expect.any(Number),
        true
      );
    });

    it('logs correct event name for simple endpoints', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ version: '1.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.ping.get();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        true
      );
    });

    it('logs success=false for failed requests', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        false
      );
    });

    it('uses generic event name for getValue without leaking key values', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ key: 'sessions:abc123', value: 'test', ttl: -1 }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.redis.getValue('sessions:abc123');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_key',
        expect.any(Number),
        true
      );
    });

    it('uses generic event name for deleteKey without leaking key values', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.deleteKey('users:user-uuid:sessions');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_delete_admin_redis_key',
        expect.any(Number),
        true
      );
    });

    it('logs the dbsize endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ count: 123 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getDbSize();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_dbsize',
        expect.any(Number),
        true
      );
    });

    it('logs the postgres info endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ok', info: {}, serverVersion: null }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.postgres.getInfo();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_info',
        expect.any(Number),
        true
      );
    });

    it('logs the postgres tables endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ tables: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.postgres.getTables();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_tables',
        expect.any(Number),
        true
      );
    });

    it('handles getKeys without pagination params', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ keys: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getKeys();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/admin/redis/keys',
        {}
      );
    });

    it('logs the admin user get endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            user: {
              id: 'user-1',
              email: 'test@example.com',
              emailConfirmed: true,
              admin: false,
              organizationIds: [],
              createdAt: '2024-01-01T12:00:00.000Z',
              lastActiveAt: null
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.users.get('user-1');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_user',
        expect.any(Number),
        true
      );
    });
  });

  describe('admin organizations endpoints', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('calls list organizations endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ organizations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.organizations.list();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/admin/organizations',
        {}
      );
    });

    it('calls get organization endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            organization: {
              id: 'org-1',
              name: 'Acme',
              description: null,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z'
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.organizations.get('org-1');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/admin/organizations/org-1',
        {}
      );
    });

    it('calls create organization endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            organization: {
              id: 'org-1',
              name: 'Acme',
              description: null,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z'
            }
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.organizations.create({ name: 'Acme' });

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/admin/organizations');
      const options = call[1];
      expect(options?.method).toBe('POST');
    });

    it('calls update organization endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            organization: {
              id: 'org-1',
              name: 'Acme',
              description: 'Updated',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z'
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.organizations.update('org-1', { description: 'Updated' });

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/admin/organizations/org-1');
      const options = call[1];
      expect(options?.method).toBe('PUT');
    });

    it('calls delete organization endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.organizations.delete('org-1');

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/admin/organizations/org-1');
      const options = call[1];
      expect(options?.method).toBe('DELETE');
    });
  });

  describe('VFS share endpoints', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('calls getShares endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ shares: [], orgShares: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.vfs.getShares('folder-1');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/vfs/items/folder-1/shares',
        {}
      );
    });

    it('calls createShare endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            share: {
              id: 'share-1',
              itemId: 'folder-1',
              userId: 'user-1',
              permission: 'read'
            }
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.vfs.createShare({
        itemId: 'folder-1',
        shareType: 'user',
        targetId: 'user-1',
        permissionLevel: 'view'
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/vfs/items/folder-1/shares');
      const options = call[1];
      expect(options?.method).toBe('POST');
    });

    it('calls updateShare endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            share: {
              id: 'share-1',
              itemId: 'folder-1',
              userId: 'user-1',
              permission: 'write'
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.vfs.updateShare('share-1', { permissionLevel: 'edit' });

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/vfs/shares/share-1');
      const options = call[1];
      expect(options?.method).toBe('PATCH');
    });

    it('calls deleteShare endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.vfs.deleteShare('share-1');

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/vfs/shares/share-1');
      const options = call[1];
      expect(options?.method).toBe('DELETE');
    });

    it('calls createOrgShare endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            orgShare: {
              id: 'org-share-1',
              itemId: 'folder-1',
              organizationId: 'org-1',
              permission: 'read'
            }
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.vfs.createOrgShare({
        itemId: 'folder-1',
        sourceOrgId: 'org-1',
        targetOrgId: 'org-2',
        permissionLevel: 'view'
      });

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe(
        'http://localhost:3000/vfs/items/folder-1/org-shares'
      );
      const options = call[1];
      expect(options?.method).toBe('POST');
    });

    it('calls deleteOrgShare endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.vfs.deleteOrgShare('org-share-1');

      const call = vi.mocked(global.fetch).mock.calls[0];
      if (!call) {
        throw new Error('Expected fetch to be called');
      }
      expect(call[0]).toBe('http://localhost:3000/vfs/org-shares/org-share-1');
      const options = call[1];
      expect(options?.method).toBe('DELETE');
    });

    it('calls searchShareTargets endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ users: [], organizations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.vfs.searchShareTargets('test');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/vfs/share-targets/search?q=test',
        {}
      );
    });

    it('calls searchShareTargets with type filter', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ users: [], organizations: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.vfs.searchShareTargets('test', 'user');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/vfs/share-targets/search?q=test&type=user',
        {}
      );
    });
  });
});
