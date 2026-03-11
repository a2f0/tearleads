import { resetApiCoreRuntimeForTesting } from '@tearleads/api-client/clientEntry';
import { type SeededUser, seedTestUser } from '@tearleads/api-test-utils';
import {
  getRecordedApiRequests,
  HttpResponse,
  http,
  server,
  wasApiRequestMade
} from '@tearleads/msw/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_TOKEN_KEY,
  resetAuthStorageRuntimeForTesting
} from '@/lib/authStorage';
import { getSharedTestContext } from '@/test/testContext';
import { setTestEnv } from '../test/env.js';

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
    resetAuthStorageRuntimeForTesting();
    vi.clearAllMocks();
    setTestEnv('VITE_API_URL', 'http://localhost');
    resetApiCoreRuntimeForTesting();
    localStorage.clear();
    const ctx = getSharedTestContext();
    seededUser = await seedTestUser(ctx, { admin: true });
    (await import('@/lib/authStorage')).setStoredAuthToken(
      seededUser.accessToken
    );
    mockLogApiEvent.mockResolvedValue(undefined);
  });
  it('routes auth requests through msw', async () => {
    // Login/register need server.use() overrides (require bcrypt password verification)
    server.use(
      http.post('http://localhost/connect/tearleads.v2.AuthService/Login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/Register',
        () =>
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
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Login')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Register')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/GetSessions')
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Logout')
    ).toBe(true);
  });
  it('supports /v1-prefixed API base URLs', async () => {
    setTestEnv('VITE_API_URL', 'http://localhost/v1');
    resetApiCoreRuntimeForTesting();
    (await import('@/lib/authStorage')).setStoredAuthToken(
      seededUser.accessToken
    );
    // Login and VFS keys need server.use() overrides
    server.use(
      http.post('http://localhost/connect/tearleads.v2.AuthService/Login', () =>
        HttpResponse.json({
          accessToken: 'login-access-token',
          refreshToken: 'login-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          refreshExpiresIn: 604800,
          user: { id: seededUser.userId, email: seededUser.email }
        })
      ),
      http.post(
        'http://localhost/connect/tearleads.v2.VfsService/GetMyKeys',
        () =>
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
    await api.adminV2.redis.getDbSize();
    await api.vfs.getMyKeys();
    await api.ai.getUsageSummary();
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Login')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/v1/connect/tearleads.v2.AdminService/GetRedisDbSize'
      )
    ).toBe(true);
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.VfsService/GetMyKeys')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/v1/connect/tearleads.v2.AiService/GetUsageSummary'
      )
    ).toBe(true);
  });
  it('retries auth requests after refresh and records request order', async () => {
    const api = await loadApi();
    let sessionsAttemptCount = 0;
    let refreshPayload: unknown = null;
    server.use(
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/GetSessions',
        ({ request }) => {
          sessionsAttemptCount += 1;
          const authHeader = request.headers.get('authorization');
          if (sessionsAttemptCount === 1) {
            expect(authHeader).toBe('Bearer stale-access-token');
            return HttpResponse.json(
              { error: 'unauthorized' },
              { status: 401 }
            );
          }
          expect(authHeader).toBe('Bearer fresh-access-token');
          return HttpResponse.json({ sessions: [] });
        }
      ),
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
        async ({ request }) => {
          refreshPayload = await request.json();
          return HttpResponse.json({
            accessToken: 'fresh-access-token',
            refreshToken: 'fresh-refresh-token'
          });
        }
      )
    );
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    (await import('@/lib/authStorage')).setStoredRefreshToken(
      'stale-refresh-token'
    );
    const sessionsResponse = await api.auth.getSessions();
    expect(sessionsResponse.sessions).toEqual([]);
    expect(sessionsAttemptCount).toBe(2);
    expect(refreshPayload).toEqual({ refreshToken: 'stale-refresh-token' });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('fresh-access-token');
    const { getStoredRefreshToken } = await import('@/lib/authStorage');
    expect(getStoredRefreshToken()).toBe('fresh-refresh-token');
    expect(
      getRecordedApiRequests().map(
        (request) => `${request.method} ${request.pathname}`
      )
    ).toEqual([
      'POST /connect/tearleads.v2.AuthService/GetSessions',
      'POST /connect/tearleads.v2.AuthService/RefreshToken',
      'POST /connect/tearleads.v2.AuthService/GetSessions'
    ]);
  });
  it('does not attempt refresh for login 401 responses', async () => {
    const api = await loadApi();
    server.use(
      http.post('http://localhost/connect/tearleads.v2.AuthService/Login', () =>
        HttpResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      )
    );
    await expect(
      api.auth.login('user@example.com', 'bad-password')
    ).rejects.toThrow('Invalid email or password');
    expect(
      wasApiRequestMade('POST', '/connect/tearleads.v2.AuthService/Login')
    ).toBe(true);
    expect(
      wasApiRequestMade(
        'POST',
        '/connect/tearleads.v2.AuthService/RefreshToken'
      )
    ).toBe(false);
  });
  it('clears auth when refresh fails and refresh token is removed', async () => {
    const api = await loadApi();
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    (await import('@/lib/authStorage')).setStoredRefreshToken(
      'stale-refresh-token'
    );
    server.use(
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/GetSessions',
        () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      ),
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
        () => {
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
      )
    );
    await expect(api.auth.getSessions()).rejects.toThrow('unauthorized');
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    const { getStoredRefreshToken } = await import('@/lib/authStorage');
    expect(getStoredRefreshToken()).toBeNull();
    expect(
      getRecordedApiRequests().map(
        (request) => `${request.method} ${request.pathname}`
      )
    ).toEqual([
      'POST /connect/tearleads.v2.AuthService/GetSessions',
      'POST /connect/tearleads.v2.AuthService/RefreshToken'
    ]);
  });
  it('deduplicates concurrent refresh attempts for parallel 401 responses', async () => {
    const api = await loadApi();
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-access-token');
    (await import('@/lib/authStorage')).setStoredRefreshToken(
      'stale-refresh-token'
    );
    let sessionsRequestCount = 0;
    let refreshRequestCount = 0;
    let releaseRefreshGate: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefreshGate = resolve;
    });
    server.use(
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/GetSessions',
        () => {
          sessionsRequestCount += 1;
          if (sessionsRequestCount <= 2) {
            if (sessionsRequestCount === 2) {
              releaseRefreshGate();
            }
            return HttpResponse.json(
              { error: 'unauthorized' },
              { status: 401 }
            );
          }
          return HttpResponse.json({ sessions: [] });
        }
      ),
      http.post(
        'http://localhost/connect/tearleads.v2.AuthService/RefreshToken',
        async () => {
          refreshRequestCount += 1;
          await refreshGate;
          return HttpResponse.json({
            accessToken: 'fresh-access-token',
            refreshToken: 'fresh-refresh-token'
          });
        }
      )
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
    const { getStoredRefreshToken } = await import('@/lib/authStorage');
    expect(getStoredRefreshToken()).toBe('fresh-refresh-token');
    const requestSequence = getRecordedApiRequests().map(
      (request) => `${request.method} ${request.pathname}`
    );
    expect(
      requestSequence.filter(
        (request) =>
          request === 'POST /connect/tearleads.v2.AuthService/RefreshToken'
      )
    ).toHaveLength(1);
  });
});
