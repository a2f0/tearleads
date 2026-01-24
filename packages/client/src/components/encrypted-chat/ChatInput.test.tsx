import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

describe('ChatInput', () => {
  const mockOnSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders textarea and send button', () => {
    render(<ChatInput onSend={mockOnSend} />);

    expect(
      screen.getByPlaceholderText('Type an encrypted message...')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('calls onSend when send button is clicked', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, 'Hello world');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(mockOnSend).toHaveBeenCalledWith('Hello world');
  });

  it('calls onSend when Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, 'Hello world{Enter}');

    expect(mockOnSend).toHaveBeenCalledWith('Hello world');
  });

  it('does not call onSend when Shift+Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it('clears input after sending', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, 'Hello world{Enter}');

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('does not send empty messages', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it('does not send whitespace-only messages', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, '   {Enter}');

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it('trims whitespace from messages', async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={mockOnSend} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    await user.type(input, '  Hello  {Enter}');

    expect(mockOnSend).toHaveBeenCalledWith('Hello');
  });

  it('disables input when disabled prop is true', () => {
    render(<ChatInput onSend={mockOnSend} disabled={true} />);

    const input = screen.getByPlaceholderText('Type an encrypted message...');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('uses custom placeholder when provided', () => {
    render(<ChatInput onSend={mockOnSend} placeholder="Custom placeholder" />);

    expect(
      screen.getByPlaceholderText('Custom placeholder')
    ).toBeInTheDocument();
  });

  it('shows lock icon', () => {
    render(<ChatInput onSend={mockOnSend} />);

    const lockIcon = document.querySelector('.lucide-lock');
    expect(lockIcon).toBeInTheDocument();
  });
});
