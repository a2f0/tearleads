import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPostgresWindow } from './index';

const mockAdminPostgresWindowBase = vi.fn((_: unknown) => (
  <div>Admin Postgres Window</div>
));

vi.mock('@/components/admin-windows', () => ({
  AdminPostgresWindow: (props: unknown) => mockAdminPostgresWindowBase(props)
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

describe('AdminPostgresWindow (client wrapper)', () => {
  const defaultProps = {
    id: 'admin-postgres-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 1
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the admin postgres window', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminPostgresWindow {...defaultProps} />);

    expect(screen.getByText('Admin Postgres Window')).toBeInTheDocument();
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

    render(<AdminPostgresWindow {...defaultProps} />);

    expect(mockAdminPostgresWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: false,
        isAuthLoading: true,
        lockedFallback: expect.anything()
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

    render(<AdminPostgresWindow {...defaultProps} />);

    const lastCall =
      mockAdminPostgresWindowBase.mock.calls[
        mockAdminPostgresWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-unlock"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-unlock"]')?.textContent
    ).toBe('Postgres Admin');
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

    render(<AdminPostgresWindow {...defaultProps} />);

    const lastCall =
      mockAdminPostgresWindowBase.mock.calls[
        mockAdminPostgresWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-login"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-login"]')?.textContent
    ).toBe('Postgres Admin');
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

    render(<AdminPostgresWindow {...defaultProps} />);

    expect(mockAdminPostgresWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: true,
        isAuthLoading: false,
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
      <AdminPostgresWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
      />
    );

    expect(mockAdminPostgresWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-postgres-1',
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
