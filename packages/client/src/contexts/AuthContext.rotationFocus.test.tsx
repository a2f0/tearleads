import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  clearStoredAuth
} from '@tearleads/api-client/authStorage';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockTryRefreshToken = vi.fn().mockResolvedValue(false);

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

vi.mock('@tearleads/api-client', () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockLogin(...args),
      logout: () => mockLogout()
    }
  },
  tryRefreshToken: () => mockTryRefreshToken()
}));

function TestComponent() {
  const {
    authError,
    isAuthenticated,
    user,
    token,
    isLoading,
    login,
    logout,
    clearAuthError
  } = useAuth();

  const handleLogin = async () => {
    await login('test@example.com', 'password123');
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div data-testid="auth-status">
        {isAuthenticated ? 'authenticated' : 'not authenticated'}
      </div>
      <div data-testid="auth-token">{token ?? 'null'}</div>
      {user && <div data-testid="user-email">{user.email}</div>}
      {authError && <div data-testid="auth-error">{authError}</div>}
      <button type="button" onClick={handleLogin}>
        Login
      </button>
      <button type="button" onClick={logout}>
        Logout
      </button>
      <button type="button" onClick={clearAuthError}>
        Clear Error
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Rotation & Focus integration', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockTryRefreshToken.mockResolvedValue(false);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('triggers refresh when tab becomes visible and token is near expiration', async () => {
      const now = new Date('2026-02-16T12:00:00.000Z');
      vi.setSystemTime(now);

      // Token expiring in 45 seconds (below 60s threshold)
      const expiringToken = createJwt(Math.floor(now.getTime() / 1000) + 45);
      localStorage.setItem(AUTH_TOKEN_KEY, expiringToken);
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      mockTryRefreshToken.mockImplementationOnce(() => {
        localStorage.setItem(AUTH_TOKEN_KEY, 'new-token');
        return Promise.resolve(true);
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Initial load should trigger refresh because it's expiring
      await waitFor(() => {
        expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
      });

      // Reset mock for next test part
      mockTryRefreshToken.mockClear();
      mockTryRefreshToken.mockResolvedValue(false);

      // Now make it "not expiring"
      const freshToken = createJwt(Math.floor(now.getTime() / 1000) + 3600);
      localStorage.setItem(AUTH_TOKEN_KEY, freshToken);

      // Dispatch storage event to sync state
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: AUTH_TOKEN_KEY,
            newValue: freshToken
          })
        );
      });

      // Focus tab - should NOT trigger refresh if token is fresh
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(mockTryRefreshToken).not.toHaveBeenCalled();

      // Now make it expiring again
      const expiringAgain = createJwt(Math.floor(now.getTime() / 1000) + 30);
      localStorage.setItem(AUTH_TOKEN_KEY, expiringAgain);
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: AUTH_TOKEN_KEY,
            newValue: expiringAgain
          })
        );
      });

      // Focus tab - SHOULD trigger refresh
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('clears auth if proactive refresh fails with expired token', async () => {
      const now = new Date('2026-02-16T12:00:00.000Z');
      vi.setSystemTime(now);

      // Token ALREADY expired
      const expiredToken = createJwt(Math.floor(now.getTime() / 1000) - 100);
      localStorage.setItem(AUTH_TOKEN_KEY, expiredToken);
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      // Mock refresh failure and ensure it clears storage (simulating real api.ts behavior)
      mockTryRefreshToken.mockImplementationOnce(() => {
        clearStoredAuth();
        return Promise.resolve(false);
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Should try to refresh on mount and fail -> clear auth
      await waitFor(() => {
        expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
      });
    });

    it('refreshes on interval when token is near expiration', async () => {
      const now = new Date('2026-02-16T12:00:00.000Z');
      vi.setSystemTime(now);

      // Token expiring in 5 minutes
      const token = createJwt(Math.floor(now.getTime() / 1000) + 300);
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.setItem('auth_refresh_token', 'refresh-token');
      localStorage.setItem(
        AUTH_USER_KEY,
        JSON.stringify({ id: '1', email: 'test@example.com' })
      );

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).toBeNull();
      });

      // No immediate refresh
      expect(mockTryRefreshToken).not.toHaveBeenCalled();

      // Advance time by 4.5 minutes -> now expiring in 30 seconds
      vi.setSystemTime(new Date(now.getTime() + 4.5 * 60 * 1000));

      // Trigger interval (30s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
    });
  });
});
