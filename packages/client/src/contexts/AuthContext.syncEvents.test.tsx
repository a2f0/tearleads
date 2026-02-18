import {
  AUTH_TOKEN_KEY,
  AUTH_USER_KEY,
  clearStoredAuth,
  setSessionExpiredError
} from '@tearleads/api-client/authStorage';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockTryRefreshToken = vi.fn().mockResolvedValue(false);

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
});
