import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailWindow } from './index';

const mockEmailWindowBase = vi.fn((_: unknown) => <div>Email Window</div>);

vi.mock('@tearleads/email', () => ({
  EmailWindow: (props: unknown) => mockEmailWindowBase(props)
}));

vi.mock('@/contexts/ClientEmailProvider', () => ({
  ClientEmailProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: vi.fn(() => ({
    to: ['ada@example.com'],
    requestId: 1
  }))
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

describe('EmailWindow', () => {
  it('renders the email window', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
    });
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false
    });

    render(
      <EmailWindow
        id="email-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    expect(screen.getByText('Email Window')).toBeInTheDocument();
    // When database is loading OR auth is loading, isDatabaseLoading is true
    // When database is locked OR not authenticated, isUnlocked is false
    expect(mockEmailWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        openComposeRequest: { to: ['ada@example.com'], requestId: 1 },
        isUnlocked: false,
        isDatabaseLoading: true,
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

    render(
      <EmailWindow
        id="email-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    // Get the lockedFallback prop passed to EmailWindowBase and render it
    const lastCall =
      mockEmailWindowBase.mock.calls[mockEmailWindowBase.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-unlock"]')
    ).toBeTruthy();
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

    render(
      <EmailWindow
        id="email-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    // Get the lockedFallback prop passed to EmailWindowBase and render it
    const lastCall =
      mockEmailWindowBase.mock.calls[mockEmailWindowBase.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const callArgs = lastCall?.[0] as { lockedFallback: React.ReactElement };
    const { container } = render(callArgs.lockedFallback);
    expect(
      container.querySelector('[data-testid="inline-login"]')
    ).toBeTruthy();
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

    render(
      <EmailWindow
        id="email-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    expect(mockEmailWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        isUnlocked: true,
        isDatabaseLoading: false
      })
    );
  });
});
