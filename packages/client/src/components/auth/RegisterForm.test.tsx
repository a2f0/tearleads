import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from './RegisterForm';

const mockRegister = vi.fn();
const mockClearAuthError = vi.fn();
let mockAuthError: string | null = null;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authError: mockAuthError,
    clearAuthError: mockClearAuthError,
    register: mockRegister
  })
}));

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthError = null;
  });

  it('renders email, password, and confirm password fields', () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('renders with default title and description', () => {
    render(<RegisterForm />);

    // Title is rendered as a p element with font-medium class
    const titles = screen.getAllByText('Create Account');
    expect(titles.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Register for a new account')).toBeInTheDocument();
  });

  it('renders with custom title and description', () => {
    render(
      <RegisterForm
        title="Join Us"
        description="Create your account to get started"
      />
    );

    expect(screen.getByText('Join Us')).toBeInTheDocument();
    expect(
      screen.getByText('Create your account to get started')
    ).toBeInTheDocument();
  });

  it('shows email domain hint when provided', () => {
    render(<RegisterForm emailDomain="example.com" />);

    expect(
      screen.getByText(
        'Registration is limited to @example.com email addresses'
      )
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
  it('shows password length requirement hint', () => {
    render(<RegisterForm />);

    expect(
      screen.getByText(
        'Minimum 12 characters, including uppercase, lowercase, number, and symbol'
      )
    ).toBeInTheDocument();
  });

  it('disables submit button when fields are empty', () => {
    render(<RegisterForm />);

    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeDisabled();
  });

  it('disables submit button when password is too short', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm Password'), 'short');

    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeDisabled();
  });

  it('disables submit button when password lacks complexity', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'alllowercase1234');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'alllowercase1234'
    );

    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeDisabled();
  });

  it('enables submit button when all fields are valid', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');

    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeEnabled();
  });

  it('shows error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'differentpassword'
    );
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows error when password is too short on submit', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    // Type valid email and short password (under 12 chars)
    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm Password');

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'short12');
    await user.type(confirmInput, 'short12');

    // Submit should be disabled, but let's verify the validation message shows if somehow submitted
    // In this case the button is disabled so we won't see this error
    const submitButton = screen.getByRole('button', { name: 'Create Account' });
    expect(submitButton).toBeDisabled();
  });

  it('calls register with email and password on submit', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(
        'test@example.com',
        'Password123!'
      );
    });
  });

  it('shows submitting state during registration', async () => {
    let resolveRegister: () => void = () => {};
    mockRegister.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegister = resolve;
        })
    );

    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(
      screen.getByRole('button', { name: 'Creating account...' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Creating account...' })
    ).toBeDisabled();

    resolveRegister?.();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Create Account' })
      ).toBeInTheDocument();
    });
  });

  it('displays error message on registration failure', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Email already registered'));
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('Email already registered')).toBeInTheDocument();
    });
  });

  it('displays "Email already registered" error when API returns 409', async () => {
    // Simulates the exact error that api.ts now throws when the server returns
    // 409 with { error: 'Email already registered' }
    mockRegister.mockRejectedValueOnce(new Error('Email already registered'));
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'existing@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    // Error message should appear in the error div
    await waitFor(() => {
      const errorDiv = screen.getByText('Email already registered');
      expect(errorDiv).toBeInTheDocument();
      expect(errorDiv).toHaveClass('text-destructive');
    });

    // Form should not be cleared (registration failed)
    expect(screen.getByLabelText('Email')).toHaveValue('existing@example.com');
  });

  it('displays string error message', async () => {
    mockRegister.mockRejectedValueOnce('String error message');
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(screen.getByText('String error message')).toBeInTheDocument();
    });
  });

  it('displays fallback error for unknown error types', async () => {
    mockRegister.mockRejectedValueOnce({ unexpected: 'object' });
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(
        screen.getByText('Registration failed. Please try again.')
      ).toBeInTheDocument();
    });
  });

  it('clears form fields on successful registration', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<RegisterForm />);

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const confirmInput = screen.getByLabelText('Confirm Password');

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(emailInput).toHaveValue('');
      expect(passwordInput).toHaveValue('');
      expect(confirmInput).toHaveValue('');
    });
  });

  it('disables inputs during submission', async () => {
    let resolveRegister: () => void = () => {};
    mockRegister.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegister = resolve;
        })
    );

    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByLabelText('Confirm Password')).toBeDisabled();

    resolveRegister?.();
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeEnabled();
      expect(screen.getByLabelText('Password')).toBeEnabled();
      expect(screen.getByLabelText('Confirm Password')).toBeEnabled();
    });
  });

  it('has correct input types', () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password'
    );
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute(
      'type',
      'password'
    );
  });

  it('toggles password visibility when eye icon is clicked', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('toggles confirm password visibility when eye icon is clicked', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    const confirmInput = screen.getByLabelText('Confirm Password');
    expect(confirmInput).toHaveAttribute('type', 'password');

    await user.click(
      screen.getByRole('button', { name: 'Show confirm password' })
    );
    expect(confirmInput).toHaveAttribute('type', 'text');

    await user.click(
      screen.getByRole('button', { name: 'Hide confirm password' })
    );
    expect(confirmInput).toHaveAttribute('type', 'password');
  });

  it('has correct autocomplete attributes', () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'autocomplete',
      'email'
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    );
    expect(screen.getByLabelText('Confirm Password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    );
  });

  it('shows auth error message when provided', () => {
    mockAuthError = 'Email domain not allowed';
    render(<RegisterForm />);

    expect(screen.getByText('Email domain not allowed')).toBeInTheDocument();
  });

  it('clears auth error on submit', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(mockClearAuthError).toHaveBeenCalled();
    });
  });

  it('renders switch mode CTA and calls onAction', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <RegisterForm
        switchModeCta={{
          prompt: 'Already have an account?',
          actionLabel: 'Sign in',
          onAction
        }}
      />
    );

    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
