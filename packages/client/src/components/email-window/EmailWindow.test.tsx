import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailWindow } from './index';

vi.mock('@rapid/email', () => ({
  EmailWindow: () => <div>Email Window</div>
}));

vi.mock('@/contexts/ClientEmailProvider', () => ({
  ClientEmailProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

describe('EmailWindow', () => {
  it('renders the email window', () => {
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
  });
});
