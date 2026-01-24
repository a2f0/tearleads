import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble', () => {
  it('renders own message with right alignment', () => {
    render(<MessageBubble isOwn={true}>Hello world</MessageBubble>);

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    const container = screen.getByText('Hello world').closest('.flex');
    expect(container).toHaveClass('justify-end');
  });

  it('renders other message with left alignment and avatar', () => {
    render(
      <MessageBubble isOwn={false} senderName="Alice" senderInitial="A">
        Hello from Alice
      </MessageBubble>
    );

    expect(screen.getByText('Hello from Alice')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows timestamp when provided', () => {
    const testDate = new Date('2024-01-15T10:30:00');
    render(
      <MessageBubble isOwn={true} timestamp={testDate}>
        Message with time
      </MessageBubble>
    );

    expect(screen.getByText('Message with time')).toBeInTheDocument();
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
  });

  it('shows default initial when not provided', () => {
    render(<MessageBubble isOwn={false}>No initial provided</MessageBubble>);

    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('does not show sender name for own messages', () => {
    render(
      <MessageBubble isOwn={true} senderName="Me">
        My message
      </MessageBubble>
    );

    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <MessageBubble isOwn={true} className="custom-class">
        Styled message
      </MessageBubble>
    );

    const container = screen.getByText('Styled message').closest('.flex');
    expect(container).toHaveClass('custom-class');
  });

  it('preserves line breaks in message content', () => {
    render(<MessageBubble isOwn={true}>Line 1{'\n'}Line 2</MessageBubble>);

    const content = screen.getByText(/Line 1/);
    expect(content).toHaveClass('whitespace-pre-line');
  });
});
