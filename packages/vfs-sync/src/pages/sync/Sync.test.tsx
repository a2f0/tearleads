import { AuthProvider } from '@client/contexts/AuthContext';
import { createTestJwtExpiresIn } from '@client/test/jwtTestUtils';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sync } from './Sync';

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockPingGet = vi.fn();
const mockTryRefreshToken = vi.fn().mockResolvedValue(false);

vi.mock('@client/lib/api', () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockLogin(...args),
      logout: () => mockLogout()
    },
    ping: {
      get: () => mockPingGet()
    }
  },
  tryRefreshToken: () => mockTryRefreshToken()
}));

function renderSync(showBackLink = true) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Sync showBackLink={showBackLink} />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPingGet.mockResolvedValue({ version: '0.0.1', dbVersion: '0.0.1' });
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
    mockLogin.mockResolvedValueOnce({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: '123', email: 'test@example.com' }
    });

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

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
      expect(screen.getByText('saved@example.com')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('handles logout', async () => {
    mockLogout.mockResolvedValueOnce({ loggedOut: true });
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

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
    let resolveLogin: (value: unknown) => void = () => {};
    mockLogin.mockImplementation(
      () =>
        new Promise((resolve) => {
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

    // Resolve the promise
    resolveLogin({
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

    renderSync(false);

    await waitFor(() => {
      expect(screen.getByText('Logged in as')).toBeInTheDocument();
    });

    expect(screen.queryByText('Back to Home')).not.toBeInTheDocument();
  });

  it('displays token expiration time in hours and minutes', async () => {
    const token = createTestJwtExpiresIn(7200); // 2 hours
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 1h 59m/)).toBeInTheDocument();
  });

  it('displays token expiration time in minutes only', async () => {
    const token = createTestJwtExpiresIn(1800); // 30 minutes
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 29m/)).toBeInTheDocument();
  });

  it('displays token expiration time in seconds for short times', async () => {
    const token = createTestJwtExpiresIn(45); // 45 seconds
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 4\ds/)).toBeInTheDocument();
  });

  it('displays hours without minutes when exactly on the hour', async () => {
    const token = createTestJwtExpiresIn(3600); // 1 hour exactly
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText(/in 59m/)).toBeInTheDocument();
  });

  it('displays expired state when token has expired', async () => {
    const token = createTestJwtExpiresIn(-60); // expired 1 minute ago
    localStorage.setItem('auth_token', token);
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: '123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Token expires')).toBeInTheDocument();
    });

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('displays email address when emailDomain is configured', async () => {
    mockPingGet.mockResolvedValue({
      version: '0.0.1',
      dbVersion: '0.0.1',
      emailDomain: 'email.example.com'
    });
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'user123', email: 'saved@example.com' })
    );

    renderSync();

    await waitFor(() => {
      expect(screen.getByText('Email address')).toBeInTheDocument();
    });

    expect(screen.getByText('user123@email.example.com')).toBeInTheDocument();
  });

  it('does not display email address when emailDomain is not configured', async () => {
    mockPingGet.mockResolvedValue({
      version: '0.0.1',
      dbVersion: '0.0.1'
    });
    localStorage.setItem('auth_token', 'saved-token');
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'user123', email: 'saved@example.com' })
    );

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
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create one' })).toBeVisible();
    });

    await user.click(screen.getByRole('button', { name: 'Create one' }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });
});
