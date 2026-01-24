import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Message, MessageList } from './MessageList';

// Mock scrollIntoView which is not available in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe('MessageList', () => {
  const mockMessages: Message[] = [
    {
      id: '1',
      senderId: 'user1',
      senderName: 'Alice',
      content: 'Hello',
      timestamp: new Date('2024-01-15T10:00:00'),
      isOwn: false
    },
    {
      id: '2',
      senderId: 'user2',
      senderName: 'Me',
      content: 'Hi there!',
      timestamp: new Date('2024-01-15T10:01:00'),
      isOwn: true
    }
  ];

  it('renders empty state when no messages', () => {
    render(<MessageList messages={[]} />);

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Send a message to start the conversation/)
    ).toBeInTheDocument();
  });

  it('renders list of messages', () => {
    render(<MessageList messages={mockMessages} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows sender name for non-own messages', () => {
    render(<MessageList messages={mockMessages} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows sender initial as avatar for non-own messages', () => {
    render(<MessageList messages={mockMessages} />);

    // Only non-own messages show avatars
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('shows timestamps for messages', () => {
    render(<MessageList messages={mockMessages} />);

    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/10:01/)).toBeInTheDocument();
  });

  it('does not show empty state when loading', () => {
    render(<MessageList messages={[]} isLoading={true} />);

    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });
});
