import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainWindow } from './KeychainWindow';

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

const mockRefresh = vi.fn();

vi.mock('./KeychainWindowMenuBar', () => ({
  KeychainWindowMenuBar: ({
    onRefresh,
    onClose
  }: {
    onRefresh: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onRefresh} data-testid="refresh-button">
        Refresh
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
    </div>
  )
}));

vi.mock('./KeychainWindowContent', () => ({
  KeychainWindowContent: vi.fn().mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ({ ref }: { ref?: any }) => {
      if (ref) {
        ref.current = { refresh: mockRefresh };
      }
      return <div data-testid="keychain-content">Keychain Content</div>;
    }
  )
}));

describe('KeychainWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockClear();
  });

  it('renders in FloatingWindow', () => {
    render(<KeychainWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays correct title', () => {
    render(<KeychainWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Keychain');
  });

  it('renders menu bar', () => {
    render(<KeychainWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders keychain content', () => {
    render(<KeychainWindow {...defaultProps} />);
    expect(screen.getByTestId('keychain-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<KeychainWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<KeychainWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls refresh on content when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<KeychainWindow {...defaultProps} />);

    await user.click(screen.getByTestId('refresh-button'));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
