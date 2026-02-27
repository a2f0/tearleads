import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineRequiresLoginAndUnlock } from './InlineRequiresLoginAndUnlock';

// Mock database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock auth context
const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

// Mock InlineUnlock
vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock for {description}</div>
  )
}));

// Mock InlineLogin (will be created in same directory)
vi.mock('./InlineLogin', () => ({
  InlineLogin: ({ description }: { description: string }) => (
    <div data-testid="inline-login">Login for {description}</div>
  )
}));

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe('InlineRequiresLoginAndUnlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading states', () => {
    it('shows loading when database is loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(
        screen.getByTestId('inline-requires-login-and-unlock-loading')
      ).toBeInTheDocument();
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows loading when auth is loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(
        screen.getByTestId('inline-requires-login-and-unlock-loading')
      ).toBeInTheDocument();
    });

    it('shows loading when both are loading', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(
        screen.getByTestId('inline-requires-login-and-unlock-loading')
      ).toBeInTheDocument();
    });
  });

  describe('unlock state (priority over login)', () => {
    it('shows InlineUnlock when database is locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      const unlockWrapper = screen.getByTestId(
        'inline-requires-login-and-unlock-unlock'
      );
      expect(unlockWrapper).toBeInTheDocument();
      expect(unlockWrapper).toHaveClass(
        'flex',
        'h-full',
        'items-center',
        'justify-center',
        'p-4'
      );
      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(screen.queryByTestId('inline-login')).not.toBeInTheDocument();
    });

    it('shows InlineUnlock even when authenticated but locked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      expect(screen.queryByTestId('inline-login')).not.toBeInTheDocument();
    });

    it('uses custom unlockDescription', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock unlockDescription="your emails">
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByText('Unlock for your emails')).toBeInTheDocument();
    });

    it('uses description as fallback for unlockDescription', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock description="email">
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByText('Unlock for email')).toBeInTheDocument();
    });
  });

  describe('login state', () => {
    it('shows InlineLogin when unlocked but not authenticated', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      const loginWrapper = screen.getByTestId(
        'inline-requires-login-and-unlock-login'
      );
      expect(loginWrapper).toBeInTheDocument();
      expect(loginWrapper).toHaveClass(
        'flex',
        'h-full',
        'items-center',
        'justify-center',
        'p-4'
      );
      expect(screen.getByTestId('inline-login')).toBeInTheDocument();
      expect(screen.queryByTestId('inline-unlock')).not.toBeInTheDocument();
    });

    it('uses custom loginDescription', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock loginDescription="your emails">
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByText('Login for your emails')).toBeInTheDocument();
    });

    it('uses description as fallback for loginDescription', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock description="email">
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByText('Login for email')).toBeInTheDocument();
    });
  });

  describe('authenticated and unlocked', () => {
    it('renders children when both authenticated and unlocked', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: true,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div data-testid="content">Protected Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByTestId('content')).toBeInTheDocument();
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
      expect(screen.queryByTestId('inline-unlock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inline-login')).not.toBeInTheDocument();
    });
  });

  describe('default description', () => {
    it('uses "this feature" as default description', () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false
      });
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false
      });

      renderWithRouter(
        <InlineRequiresLoginAndUnlock>
          <div>Content</div>
        </InlineRequiresLoginAndUnlock>
      );

      expect(screen.getByText('Unlock for this feature')).toBeInTheDocument();
    });
  });
});
