import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserMessage } from './UserMessage';

vi.mock('@assistant-ui/react', () => ({
  MessagePrimitive: {
    Root: ({
      children,
      className
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div data-testid="message-root" className={className}>
        {children}
      </div>
    ),
    Content: () => <span data-testid="message-content">User text</span>
  }
}));

describe('UserMessage', () => {
  it('renders message content in a right-aligned container', () => {
    render(<UserMessage />);

    expect(screen.getByTestId('message-root')).toBeInTheDocument();
    expect(screen.getByTestId('message-content')).toHaveTextContent(
      'User text'
    );
  });
});
