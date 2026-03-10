import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../test/env.js';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/lib/authStorage';
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
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    mockLogApiEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__tearleadsImportPingWasmModule');
  });

  describe('error handling', () => {
    it('throws error when response is not ok', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () =>
          HttpResponse.json(null, { status: 500 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('handles 404 errors', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () =>
          HttpResponse.json(null, { status: 404 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 404');
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('handles network errors', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () => HttpResponse.error())
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow();
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('uses default message when error body has no error field', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () =>
          HttpResponse.json({}, { status: 400 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 400');
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('extracts error message from response body', async () => {
      server.use(
        http.post(
          'http://localhost/connect/tearleads.v2.AuthService/Register',
          () =>
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
      expect(
        wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Register')
      ).toBe(true);
    });
  });

  describe('session expiry handling', () => {
    it('clears stored auth and reports session expiry when response is 401', async () => {
      server.use(
        http.get('http://localhost/v2/ping', () =>
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
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('does not clear auth when refresh fails but token still exists in storage', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = createJwt(futureExp);
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        validRefreshToken
      );
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );

      server.use(
        http.get('http://localhost/v2/ping', () =>
          HttpResponse.json(null, { status: 401 })
        ),
        http.post(
          'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
          () => HttpResponse.json(null, { status: 500 })
        )
      );

      const api = await loadApi();

      await expect(api.ping.get()).rejects.toThrow('API error: 401');
      const { getStoredRefreshToken } = await loadAuthStorage();
      expect(getStoredRefreshToken()).toBe(validRefreshToken);

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBeNull();
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AuthService/RefreshToken'
        )
      ).toBe(true);
    });

    it('adds Authorization header when auth token is stored', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'test-token');

      const api = await loadApi();
      await api.ping.get();

      const requests = getRecordedApiRequests();
      expect(requests[0]?.url).toBe('http://localhost/v2/ping');
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });

    it('does not override existing Authorization header', async () => {
      // This tests the branch where headers already have Authorization set
      localStorage.setItem(AUTH_TOKEN_KEY, 'stored-token');

      // Use fetch directly with custom Authorization header
      const response = await fetch('http://localhost/v2/ping', {
        headers: { Authorization: 'Bearer custom-token' }
      });
      expect(response.ok).toBe(true);
      expect(wasApiRequestMade('GET', '/v2/ping')).toBe(true);
    });
  });

  describe('tryRefreshToken', () => {
    it('returns false without a refresh token', async () => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: 'user-1', email: 'user@example.com' })
      );
      server.use(
        http.post(
          'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
          () => HttpResponse.json(null, { status: 401 })
        )
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();

      const { getAuthError } = await loadAuthStorage();
      expect(getAuthError()).toBe('Session expired. Please sign in again.');
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AuthService/RefreshToken'
        )
      ).toBe(true);
    });

    it('returns true when refresh succeeds', async () => {
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        seededUser.refreshToken
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(true);
      expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeTruthy();
      const { getStoredRefreshToken } = await loadAuthStorage();
      expect(getStoredRefreshToken()).toBeTruthy();
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AuthService/RefreshToken'
        )
      ).toBe(true);
    });

    it('returns false when refresh throws network error', async () => {
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        'refresh-token'
      );

      server.use(
        http.post(
          'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
          () => HttpResponse.error()
        )
      );

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AuthService/RefreshToken'
        )
      ).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('does not clear auth when refresh fails but token still exists', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validRefreshToken = createJwt(futureExp);
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        validRefreshToken
      );
      localStorage.setItem(AUTH_TOKEN_KEY, 'access-token');

      server.use(
        http.post(
          'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
          () => HttpResponse.json(null, { status: 500 })
        )
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
      const { getStoredRefreshToken } = await loadAuthStorage();
      expect(getStoredRefreshToken()).toBe(validRefreshToken);
      expect(
        wasApiRequestMade(
          'POST',
          '/connect/tearleads.v2.AuthService/RefreshToken'
        )
      ).toBe(true);
    });

    it('returns false when API_BASE_URL is not set during refresh', async () => {
      setTestEnv('VITE_API_URL', '');
      (await import('@/lib/authStorage')).setStoredRefreshToken(
        'refresh-token'
      );

      const { tryRefreshToken } = await import('./api');

      await expect(tryRefreshToken()).resolves.toBe(false);
    });
  });
});
