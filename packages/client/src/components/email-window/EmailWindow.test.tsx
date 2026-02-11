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

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

describe('EmailWindow', () => {
  it('renders the email window', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: true
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
    expect(mockEmailWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        openComposeRequest: { to: ['ada@example.com'], requestId: 1 },
        isUnlocked: false,
        isDatabaseLoading: true,
        lockedFallback: expect.anything()
      })
    );
  });
});
