import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  clearStoredAuth,
  setSessionExpiredError
} from '@/lib/authStorage';
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

vi.mock('@/lib/api', () => ({
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

  it('provides initial unauthenticated state', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });
  });

  it('loads existing session from localStorage', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
      expect(screen.getByTestId('auth-token')).toHaveTextContent('saved-token');
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'saved@example.com'
      );
    });
  });

  it('syncs refreshed token into state on mount', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'stale-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    mockTryRefreshToken.mockImplementationOnce(() => {
      localStorage.setItem(AUTH_TOKEN_KEY, 'refreshed-token');
      return Promise.resolve(true);
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
      expect(screen.getByTestId('auth-token')).toHaveTextContent(
        'refreshed-token'
      );
    });
  });

  it('refreshes the token on an interval when nearing expiration', async () => {
    const now = new Date('2026-02-05T12:00:00.000Z');
    const expiresAt = Math.floor(now.getTime() / 1000) + 5 * 60;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(now);
    localStorage.setItem(AUTH_TOKEN_KEY, createJwt(expiresAt));
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    const refreshedToken = createJwt(expiresAt + 3600);
    mockTryRefreshToken.mockImplementationOnce(() => {
      localStorage.setItem(AUTH_TOKEN_KEY, refreshedToken);
      return Promise.resolve(true);
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    vi.setSystemTime(new Date('2026-02-05T12:04:30.000Z'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockTryRefreshToken).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('auth-token')).toHaveTextContent(
        refreshedToken
      );
    });

    vi.useRealTimers();
  });

  it('handles login success', async () => {
    mockLogin.mockResolvedValueOnce({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: '456', email: 'new@example.com' }
    });

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'new@example.com'
      );
    });

    expect(localStorage.getItem('auth_token')).toBe('test-token');
    expect(JSON.parse(localStorage.getItem('auth_user') ?? '{}')).toEqual({
      id: '456',
      email: 'new@example.com'
    });
  });

  it('handles logout and calls server API', async () => {
    mockLogout.mockResolvedValueOnce({ loggedOut: true });
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('clears local state even when logout API fails (offline support)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockLogout.mockRejectedValueOnce(new Error('Network error'));
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(consoleWarn).toHaveBeenCalledWith(
      'Server-side logout failed:',
      expect.any(Error)
    );

    consoleWarn.mockRestore();
  });

  it('clears invalid localStorage data', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'invalid-token');
    localStorage.setItem(AUTH_USER_KEY, 'not valid json');

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('updates when auth storage is cleared externally', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    act(() => {
      clearStoredAuth();
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });
  });

  it('updates when auth storage changes in another tab', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    localStorage.setItem(AUTH_TOKEN_KEY, 'tab-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '321', email: 'tab@example.com' })
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: AUTH_TOKEN_KEY,
          newValue: 'tab-token',
          oldValue: null
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'tab@example.com'
      );
    });
  });

  it('updates when auth storage is cleared in another tab', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: AUTH_TOKEN_KEY,
          newValue: null,
          oldValue: 'saved-token'
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });
  });

  it('updates when auth user changes in another tab', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'saved@example.com'
      );
    });

    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '456', email: 'updated@example.com' })
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: AUTH_USER_KEY,
          newValue: JSON.stringify({
            id: '456',
            email: 'updated@example.com'
          }),
          oldValue: JSON.stringify({
            id: '123',
            email: 'saved@example.com'
          })
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent(
        'updated@example.com'
      );
    });
  });

  it('updates when storage is cleared in another tab', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'saved-token');
    localStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'authenticated'
      );
    });

    localStorage.clear();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
          newValue: null,
          oldValue: null
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });
  });

  it('updates when session expiration is reported', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    act(() => {
      setSessionExpiredError();
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-error')).toHaveTextContent(
        'Session expired. Please sign in again.'
      );
    });
  });

  it('clears auth error when clearAuthError is called', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    act(() => {
      setSessionExpiredError();
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-error')).toHaveTextContent(
        'Session expired. Please sign in again.'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Clear Error' }));

    await waitFor(() => {
      expect(screen.queryByTestId('auth-error')).toBeNull();
    });
  });

  it('throws error when useAuth is used outside provider', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    expect(() => render(<TestComponent />)).toThrow(
      'useAuth must be used within an AuthProvider'
    );

    consoleError.mockRestore();
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
