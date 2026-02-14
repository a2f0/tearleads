import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineLogin } from './InlineLogin';

const mockLogin = vi.fn();
const mockClearAuthError = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authError: null,
    clearAuthError: mockClearAuthError,
    login: mockLogin
  })
}));

describe('InlineLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with data-testid', () => {
    render(<InlineLogin />);

    expect(screen.getByTestId('inline-login')).toBeInTheDocument();
  });

  it('renders default description', () => {
    render(<InlineLogin />);

    expect(
      screen.getByText('Sign in required to access this feature.')
    ).toBeInTheDocument();
  });

  it('renders custom description', () => {
    render(<InlineLogin description="email" />);

    expect(
      screen.getByText('Sign in required to access email.')
    ).toBeInTheDocument();
  });

  it('renders login form', () => {
    render(<InlineLogin />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('passes custom description to login form', () => {
    render(<InlineLogin description="email" />);

    expect(
      screen.getByText('Please sign in to continue to email')
    ).toBeInTheDocument();
  });

  it('renders user icon', () => {
    render(<InlineLogin />);

    const icon = screen.getByTestId('inline-login').querySelector('svg');
    expect(icon).toBeInTheDocument();
  });
});
