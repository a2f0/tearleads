import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const mockLogin = vi.fn();
const mockTryRefreshToken = vi.fn().mockResolvedValue(false);
const mockSetVfsRecoveryPassword = vi.fn();
const mockGetCurrentDatabaseInstanceId = vi.fn();
const mockSetDatabasePassword = vi.fn();
const mockGetInstance = vi.fn();
const mockUpdateInstance = vi.fn();
const mockNotificationWarning = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockLogin(...args),
      register: vi.fn(),
      logout: vi.fn()
    }
  },
  tryRefreshToken: () => mockTryRefreshToken()
}));

vi.mock('@/hooks/vfs/useVfsKeys', () => ({
  createVfsKeySetupPayloadForOnboarding: vi.fn(),
  setVfsRecoveryPassword: (...args: unknown[]) =>
    mockSetVfsRecoveryPassword(...args)
}));

vi.mock('@/db', () => ({
  getCurrentInstanceId: (...args: unknown[]) =>
    mockGetCurrentDatabaseInstanceId(...args),
  setDatabasePassword: (...args: unknown[]) => mockSetDatabasePassword(...args)
}));

vi.mock('@/db/instanceRegistry', () => ({
  getInstance: (...args: unknown[]) => mockGetInstance(...args),
  updateInstance: (...args: unknown[]) => mockUpdateInstance(...args)
}));

vi.mock('@/stores/notificationStore', () => ({
  notificationStore: {
    warning: (...args: unknown[]) => mockNotificationWarning(...args)
  }
}));

function LoginHarness() {
  const { isLoading, isAuthenticated, login, getTokenTimeRemaining } =
    useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const handleLogin = async () => {
    await login('test@example.com', 'password123');
  };

  return (
    <div>
      <div data-testid="auth-status">
        {isAuthenticated ? 'authenticated' : 'not authenticated'}
      </div>
      <div data-testid="token-remaining">{String(getTokenTimeRemaining())}</div>
      <button type="button" onClick={handleLogin}>
        Login
      </button>
    </div>
  );
}

describe('AuthContext deferred password setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockLogin.mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: '456', email: 'new@example.com' }
    });

    mockGetCurrentDatabaseInstanceId.mockReturnValue('instance-1');
    mockGetInstance.mockResolvedValue({
      id: 'instance-1',
      passwordDeferred: true
    });
    mockSetDatabasePassword.mockResolvedValue(true);
    mockUpdateInstance.mockResolvedValue(undefined);
    mockNotificationWarning.mockReset();
  });

  it('sets deferred database password on login for deferred instance', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <LoginHarness />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockSetDatabasePassword).toHaveBeenCalledWith(
        'password123',
        'instance-1'
      );
    });
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-1', {
      passwordDeferred: false
    });
    expect(mockSetVfsRecoveryPassword).toHaveBeenCalledWith('password123');
  });

  it('retries deferred password setup and succeeds before warning', async () => {
    const user = userEvent.setup();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSetDatabasePassword
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(
      <AuthProvider>
        <LoginHarness />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockSetDatabasePassword).toHaveBeenCalledTimes(3);
    });
    expect(mockUpdateInstance).toHaveBeenCalledWith('instance-1', {
      passwordDeferred: false
    });
    expect(mockNotificationWarning).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('skips deferred password setup when instance is not deferred', async () => {
    const user = userEvent.setup();
    mockGetInstance.mockResolvedValue({
      id: 'instance-1',
      passwordDeferred: false
    });

    render(
      <AuthProvider>
        <LoginHarness />
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
    });

    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });

  it('logs warning and keeps deferred flag when password save fails', async () => {
    const user = userEvent.setup();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSetDatabasePassword.mockResolvedValue(false);

    render(
      <AuthProvider>
        <LoginHarness />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent(
        'not authenticated'
      );
    });

    await user.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockSetDatabasePassword).toHaveBeenCalledTimes(3);
    });
    expect(mockSetDatabasePassword).toHaveBeenNthCalledWith(
      1,
      'password123',
      'instance-1'
    );
    expect(mockSetDatabasePassword).toHaveBeenNthCalledWith(
      2,
      'password123',
      'instance-1'
    );
    expect(mockSetDatabasePassword).toHaveBeenNthCalledWith(
      3,
      'password123',
      'instance-1'
    );
    expect(consoleWarn).toHaveBeenCalledWith(
      'Skipping deferred DB password setup because no active key was available'
    );
    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Database Password Not Set',
      'Your account is signed in, but database password setup failed. Set it manually before locking while signed out.'
    );
    expect(mockUpdateInstance).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('swallows instance lookup errors during deferred password setup', async () => {
    const user = userEvent.setup();
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetInstance.mockRejectedValue(new Error('lookup failed'));

    render(
      <AuthProvider>
        <LoginHarness />
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
    });

    expect(consoleWarn).toHaveBeenCalledWith(
      'Failed to configure deferred DB password from auth:',
      expect.any(Error)
    );
    expect(mockNotificationWarning).toHaveBeenCalledWith(
      'Database Password Setup Failed',
      'Could not complete deferred database password setup. Set it manually before locking while signed out.'
    );
    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockUpdateInstance).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('skips deferred setup when no active instance is selected', async () => {
    const user = userEvent.setup();
    mockGetCurrentDatabaseInstanceId.mockReturnValue(null);

    render(
      <AuthProvider>
        <LoginHarness />
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
    });

    expect(mockSetDatabasePassword).not.toHaveBeenCalled();
    expect(mockUpdateInstance).not.toHaveBeenCalled();
  });
});
