import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Email } from './Email';

vi.mock('@tearleads/email', () => ({
  Email: (props: unknown) => {
    const typed = props as {
      isUnlocked?: boolean;
      isLoading?: boolean;
      lockedFallback?: ReactNode;
    };
    return (
      <div>
        <div>Email App</div>
        <div data-testid="is-unlocked">{String(typed.isUnlocked)}</div>
        <div data-testid="is-loading">{String(typed.isLoading)}</div>
        {typed.lockedFallback}
      </div>
    );
  }
}));

vi.mock('@/contexts/ClientEmailProvider', () => ({
  ClientEmailProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
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

describe('Email', () => {
  it('passes unlocked state to email app and lock fallback', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false
    });

    render(<Email />);

    expect(screen.getByText('Email App')).toBeInTheDocument();
    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('true');
    expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('inline-unlock')).toHaveTextContent('email');
  });

  it('renders the email app', () => {
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: false,
      isLoading: false
    });

    render(<Email />);

    expect(screen.getByText('Email App')).toBeInTheDocument();
    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('false');
  });
});
