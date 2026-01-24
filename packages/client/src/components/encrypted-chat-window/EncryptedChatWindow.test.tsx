import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedChatWindow } from './EncryptedChatWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/encrypted-chat', () => ({
  EncryptedChat: () => (
    <div data-testid="encrypted-chat-content">Encrypted Chat Content</div>
  )
}));

describe('EncryptedChatWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<EncryptedChatWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows correct title', () => {
    render(<EncryptedChatWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Encrypted Chat'
    );
  });

  it('renders EncryptedChat component', () => {
    render(<EncryptedChatWindow {...defaultProps} />);
    expect(screen.getByTestId('encrypted-chat-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <EncryptedChatWindow {...defaultProps} onClose={onClose} />
    );

    getByTestId('close-window').click();
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    render(
      <EncryptedChatWindow
        {...defaultProps}
        initialDimensions={{ x: 100, y: 200, width: 800, height: 600 }}
      />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });
});
