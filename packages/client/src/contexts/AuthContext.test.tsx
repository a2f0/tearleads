import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@tearleads/api-client/authStorage';
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
});
