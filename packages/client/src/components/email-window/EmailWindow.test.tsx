import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailWindow } from './index';

const mockEmailWindowBase = vi.fn((_: unknown) => <div>Email Window</div>);

vi.mock('@rapid/email', () => ({
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
    expect(mockEmailWindowBase).toHaveBeenCalledWith(
      expect.objectContaining({
        openComposeRequest: { to: ['ada@example.com'], requestId: 1 }
      })
    );
  });
});
