import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRedisWindow } from './index';

const mockAdminRedisWindowBase = vi.fn((_: unknown) => (
  <div>Admin Redis Window</div>
));

vi.mock('@tearleads/app-admin/clientEntry', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@tearleads/app-admin/clientEntry')),
  AdminRedisWindow: (props: unknown) => mockAdminRedisWindowBase(props)
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

describe('AdminRedisWindow (client wrapper)', () => {
  const defaultProps = {
    id: 'admin-redis-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 1
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the admin redis window', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false
    });

    render(<AdminRedisWindow {...defaultProps} />);

    expect(screen.getByText('Admin Redis Window')).toBeInTheDocument();
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

    render(<AdminRedisWindow {...defaultProps} />);

    expect(mockAdminRedisWindowBase).toHaveBeenCalledWith(
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

    render(<AdminRedisWindow {...defaultProps} />);

    const lastCall =
      mockAdminRedisWindowBase.mock.calls[
        mockAdminRedisWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-unlock"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-unlock"]')?.textContent
    ).toBe('Redis Admin');
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

    render(<AdminRedisWindow {...defaultProps} />);

    const lastCall =
      mockAdminRedisWindowBase.mock.calls[
        mockAdminRedisWindowBase.mock.calls.length - 1
      ];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-login"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inline-login"]')?.textContent
    ).toBe('Redis Admin');
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

    render(<AdminRedisWindow {...defaultProps} />);

    expect(mockAdminRedisWindowBase).toHaveBeenCalledWith(
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
      <AdminRedisWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
      />
    );

    expect(mockAdminRedisWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-redis-1',
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
