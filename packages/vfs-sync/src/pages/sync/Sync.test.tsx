import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestJwtExpiresIn } from '../../test/jwtTestUtils';
import {
  type LoginResult,
  mockLogin,
  mockPingGet,
  renderSync,
  resetSyncTestState,
  setupSyncDependencies
} from './syncTestHelpers';

function queries(): ReturnType<typeof within> {
  return within(document.body);
}

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
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    expect(queries().getByLabelText('Email')).toBeInTheDocument();
    expect(queries().getByLabelText('Password')).toBeInTheDocument();
    expect(
      queries().getByRole('button', { name: 'Sign In' })
    ).toBeInTheDocument();
    expect(
      queries().queryByRole('heading', { name: 'Sync' })
    ).not.toBeInTheDocument();
  });

  it('renders user icon in unauthenticated card', async () => {
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    const card = document.querySelector('.rounded-lg.border.bg-background');
    expect(card).toBeInTheDocument();
    expect(card?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows back link by default', async () => {
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    expect(queries().getByText('Back to Home')).toBeInTheDocument();
  });

  it('hides back link when showBackLink is false', async () => {
    renderSync(false);

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    expect(queries().queryByText('Back to Home')).not.toBeInTheDocument();
  });

  it('handles successful login', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'password123');
    await user.click(queries().getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
      expect(queries().getByText('test@example.com')).toBeInTheDocument();
    });

    expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
  });

  it('handles login failure with Error message', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'wrongpassword');
    await user.click(queries().getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(queries().getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('handles login failure with string error', async () => {
    mockLogin.mockRejectedValueOnce('Something went wrong');

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'wrongpassword');
    await user.click(queries().getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(queries().getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  it('handles login failure with unknown error type', async () => {
    mockLogin.mockRejectedValueOnce({ code: 500 });

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'wrongpassword');
    await user.click(queries().getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        queries().getByText('Login failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('disables submit button when fields are empty', async () => {
    renderSync();

    await waitFor(() => {
      expect(queries().getByRole('button', { name: 'Sign In' })).toBeDisabled();
    });
  });

  it('enables submit button when fields have values', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'password123');

    await waitFor(() => {
      expect(
        queries().getByRole('button', { name: 'Sign In' })
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
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
      expect(queries().getByText('saved@example.com')).toBeInTheDocument();
    });

    expect(
      queries().getByRole('button', { name: 'Logout' })
    ).toBeInTheDocument();
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
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
    });

    await user.click(queries().getByRole('button', { name: 'Logout' }));

    await waitFor(() => {
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
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
      expect(queries().getByLabelText('Email')).toBeInTheDocument();
    });

    await user.type(queries().getByLabelText('Email'), 'test@example.com');
    await user.type(queries().getByLabelText('Password'), 'password123');
    await user.click(queries().getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        queries().getByRole('button', { name: 'Signing in...' })
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
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
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
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
    });

    expect(queries().queryByText('Back to Home')).not.toBeInTheDocument();
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
      expect(queries().getByText('Token expires')).toBeInTheDocument();
    });

    expect(queries().getByText(/in 1h 59m/)).toBeInTheDocument();
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
      expect(queries().getByText('Token expires')).toBeInTheDocument();
    });

    expect(queries().getByText(/in 29m/)).toBeInTheDocument();
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
      expect(queries().getByText('Token expires')).toBeInTheDocument();
    });

    expect(queries().getByText(/in 4\ds/)).toBeInTheDocument();
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
      expect(queries().getByText('Token expires')).toBeInTheDocument();
    });

    expect(queries().getByText(/in 59m/)).toBeInTheDocument();
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
      expect(queries().getByText('Token expires')).toBeInTheDocument();
    });

    expect(queries().getByText('Expired')).toBeInTheDocument();
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
      expect(queries().getByText('Email address')).toBeInTheDocument();
    });

    expect(
      queries().getByText('user123@email.example.com')
    ).toBeInTheDocument();
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
      expect(queries().getByText('Logged in as')).toBeInTheDocument();
    });

    expect(queries().queryByText('Email address')).not.toBeInTheDocument();
  });

  it('switches from login mode to register mode', async () => {
    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(
        queries().getByRole('button', { name: 'Create one' })
      ).toBeVisible();
    });

    await user.click(queries().getByRole('button', { name: 'Create one' }));

    expect(
      queries().getByRole('button', { name: 'Create Account' })
    ).toBeInTheDocument();
  });

  it('switches from register mode back to login mode', async () => {
    setupSyncDependencies('register');

    const user = userEvent.setup();
    renderSync();

    await waitFor(() => {
      expect(queries().getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    await user.click(queries().getByRole('button', { name: 'Sign in' }));

    expect(
      queries().getByRole('button', { name: 'Sign In' })
    ).toBeInTheDocument();
  });
});
