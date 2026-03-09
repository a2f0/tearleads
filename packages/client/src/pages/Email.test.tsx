import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Email } from './Email';

vi.mock('@tearleads/email', () => ({
  Email: (props: unknown) => {
    const typed = props as { lockedFallback?: ReactNode };
    return (
      <div>
        <div>Email App</div>
        <div data-testid="has-locked-fallback">
          {String(Boolean(typed.lockedFallback))}
        </div>
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

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

describe('Email', () => {
  it('passes lock fallback to email app', () => {
    render(<Email />);

    expect(screen.getByText('Email App')).toBeInTheDocument();
    expect(screen.getByTestId('has-locked-fallback')).toHaveTextContent('true');
    expect(screen.getByTestId('inline-unlock')).toHaveTextContent('email');
  });

  it('renders the email app', () => {
    render(<Email />);

    expect(screen.getByText('Email App')).toBeInTheDocument();
  });
});
