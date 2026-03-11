import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

const mockUseAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({
    defaultTo,
    defaultLabel
  }: {
    defaultTo: string;
    defaultLabel: string;
  }) => (
    <a data-testid="back-link" href={defaultTo}>
      {defaultLabel}
    </a>
  )
}));

vi.mock('./LoginForm', () => ({
  LoginForm: ({
    title,
    description
  }: {
    title?: string;
    description?: string;
  }) => (
    <div data-testid="login-form">
      <span data-testid="login-title">{title}</span>
      <span data-testid="login-description">{description}</span>
    </div>
  )
}));

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when auth is loading', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
  });

  it('shows login form when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('shows back link when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    const backLink = screen.getByTestId('back-link');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveTextContent('Back to Home');
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
  });

  it('passes default title and description to LoginForm', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByTestId('login-title')).toHaveTextContent(
      'Authentication Required'
    );
    expect(screen.getByTestId('login-description')).toHaveTextContent(
      'Please sign in to access this page'
    );
  });

  it('passes custom title and description to LoginForm', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <RequireAuth
        loginTitle="AI Requires Login"
        loginDescription="Sign in to access AI features"
      >
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByTestId('login-title')).toHaveTextContent(
      'AI Requires Login'
    );
    expect(screen.getByTestId('login-description')).toHaveTextContent(
      'Sign in to access AI features'
    );
  });

  it('renders multiple children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>First Child</div>
        <div>Second Child</div>
      </RequireAuth>
    );

    expect(screen.getByText('First Child')).toBeInTheDocument();
    expect(screen.getByText('Second Child')).toBeInTheDocument();
  });

  it('does not render loading state when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('does not render login form when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
  });
});
