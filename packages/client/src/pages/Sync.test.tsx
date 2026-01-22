import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { Sync } from './Sync';

const mockLogin = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      login: (...args: unknown[]) => mockLogin(...args)
    }
  }
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
});
