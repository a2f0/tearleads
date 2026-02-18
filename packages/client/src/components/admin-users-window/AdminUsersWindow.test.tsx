import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersWindow } from './index';

const mockAdminUsersWindowBase = vi.fn((_: unknown) => (
  <div>Admin Users Window</div>
));

vi.mock('@/components/admin-windows', () => ({
  AdminUsersWindow: (props: unknown) => mockAdminUsersWindowBase(props)
}));

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth()
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

vi.mock('@/components/auth/InlineLogin', () => ({
  InlineLogin: ({ description }: { description: string }) => (
    <div data-testid="inline-login">{description}</div>
  )
}));

describe('AdminUsersWindow (client wrapper)', () => {
  const defaultProps = {
    id: 'admin-users-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 1
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the admin users window', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    expect(screen.getByText('Admin Users Window')).toBeInTheDocument();
  });

  it('passes isUnlocked=false and isAuthLoading=true when database is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    expect(mockAdminUsersWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: false,
        isAuthLoading: true,
        lockedFallback: expect.anything()
      })
    );
  });

  it('passes isUnlocked=false and isAuthLoading=true when auth is loading', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true
    });

    render(<AdminUsersWindow {...defaultProps} />);

    expect(mockAdminUsersWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: false,
        isAuthLoading: true
      })
    );
  });

  it('passes InlineUnlock fallback when database is locked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    const lastCall =
      mockAdminUsersWindowBase.mock.calls[
        mockAdminUsersWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-unlock"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-unlock"]')?.textContent
    ).toBe('Users Admin');
  });

  it('passes InlineLogin fallback when unlocked but not authenticated', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    const lastCall =
      mockAdminUsersWindowBase.mock.calls[
        mockAdminUsersWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-login"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-login"]')?.textContent
    ).toBe('Users Admin');
  });

  it('sets isUnlocked to true when both authenticated and database unlocked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    expect(mockAdminUsersWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: true,
        isAuthLoading: false
      })
    );
  });

  it('passes null lockedFallback when fully unlocked', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminUsersWindow {...defaultProps} />);

    expect(mockAdminUsersWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedFallback: null
      })
    );
  });

  it('passes through all window props to base component', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    const initialDimensions = { width: 800, height: 600, x: 100, y: 100 };
    const onDimensionsChange = vi.fn();
    const onRename = vi.fn();

    render(
      <AdminUsersWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
      />
    );

    expect(mockAdminUsersWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-users-1',
        onClose: defaultProps.onClose,
        onMinimize: defaultProps.onMinimize,
        onFocus: defaultProps.onFocus,
        zIndex: 1,
        initialDimensions,
        onDimensionsChange,
        onRename
      })
    );
  });
});
