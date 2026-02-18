import { createTestJwtExpiresIn } from '@client/test/jwtTestUtils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mockLogin,
  mockPingGet,
  renderSync,
  resetSyncTestState,
  setupSyncDependencies,
  type LoginResult
} from './Sync.testHelpers';

describe('Sync', () => {
  beforeEach(() => {
    resetSyncTestState();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders login form when not authenticated', async () => {
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows back link by default', async () => {
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument();
    });

    expect(screen.getByText('Back to Home')).toBeInTheDocument();
  });

  it('hides back link when showBackLink is false', async () => {
    renderSync(false);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument();
    });

    expect(screen.queryByText('Back to Home')).not.toBeInTheDocument();
  });

  it('handles successful login', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
  });

  it('handles login failure with Error message', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('handles login failure with string error', async () => {
    mockLogin.mockRejectedValueOnce('Something went wrong');

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  it('handles login failure with unknown error type', async () => {
    mockLogin.mockRejectedValueOnce({ code: 500 });

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Login failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('disables submit button when fields are empty', async () => {
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
    });
  });

  it('enables submit button when fields have values', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Sign In' })
      ).not.toBeDisabled();
    });
  });

  it('shows authenticated state when logged in', async () => {
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
      expect(screen.getByText('saved@example.com')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('handles logout', async () => {
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });
  });

  it('shows submitting state during login', async () => {
    let resolveLogin: ((result: LoginResult) => void) | null = null;
    mockLogin.mockImplementationOnce(
      () =>
        new Promise<LoginResult>((resolve) => {
          resolveLogin = resolve;
        })
    );

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Signing in...' })
      ).toBeInTheDocument();
    });

    expect(resolveLogin).not.toBeNull();
    resolveLogin?.({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: '123', email: 'test@example.com' }
    });

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
    });
  });

  it('hides back link in authenticated state when showBackLink is false', async () => {
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync(false);

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
    });

    expect(screen.queryByText('Back to Home')).not.toBeInTheDocument();
  });

  it('displays token expiration time in hours and minutes', async () => {
    const token = createTestJwtExpiresIn(7200);
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 1h 59m/)).toBeInTheDocument();
  });

  it('displays token expiration time in minutes only', async () => {
    const token = createTestJwtExpiresIn(1800);
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 29m/)).toBeInTheDocument();
  });

  it('displays token expiration time in seconds for short times', async () => {
    const token = createTestJwtExpiresIn(45);
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 4\ds/)).toBeInTheDocument();
  });

  it('displays hours without minutes when exactly on the hour', async () => {
    const token = createTestJwtExpiresIn(3600);
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 59m/)).toBeInTheDocument();
  });

  it('displays expired state when token has expired', async () => {
    const token = createTestJwtExpiresIn(-60);
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('displays email address when emailDomain is configured', async () => {
    mockPingGet.mockResolvedValueOnce({ emailDomain: 'email.example.com' });
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'user123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Email address')).toBeInTheDocument();
    });

    expect(screen.getByText('user123@email.example.com')).toBeInTheDocument();
  });

  it('does not display email address when emailDomain is not configured', async () => {
    mockPingGet.mockResolvedValueOnce({});
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'user123', email: 'saved@example.com' })
    );
    setupSyncDependencies();

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
    });

    expect(screen.queryByText('Email address')).not.toBeInTheDocument();
  });

  it('switches from login mode to register mode', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create one' })).toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Create one' }));

    expect(
      screen.getByRole('button', { name: 'Create Account' })
    ).toBeInTheDocument();
  });

  it('switches from register mode back to login mode', async () => {
    setupSyncDependencies('register');

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });
});
