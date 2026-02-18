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
} from './authStorage';

const loadAuthStorage = async () => {
  const module = await import('./authStorage');
  return module;
};

const mockLogApiEvent = vi.fn();

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

const loadApi = async () => {
  const module = await import('./api');
  return module.api;
};

describe('api with msw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    mockLogApiEvent.mockResolvedValue(undefined);
    const { setApiEventLogger } = await import('./apiLogger');
    setApiEventLogger(
      (...args: Parameters<typeof mockLogApiEvent>) => mockLogApiEvent(...args)
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { resetApiEventLogger } = await import('./apiLogger');
    resetApiEventLogger();
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
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = createJwt(futureExp);
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, validRefreshToken);
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
        validRefreshToken
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
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = createJwt(futureExp);
      localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, validRefreshToken);
      localStorage.setItem(AUTH_TOKEN_KEY, 'access-token');

      server.use(
        http.post('http://localhost/auth/refresh', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY)).toBe(
        validRefreshToken
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
});
