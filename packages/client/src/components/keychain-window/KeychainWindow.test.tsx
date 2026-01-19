import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeychainWindow } from './KeychainWindow';
import type { KeychainWindowContentRef } from './KeychainWindowContent';

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
  KeychainWindowContent: vi
    .fn()
    .mockImplementation(
      ({
        ref,
        onSelectInstance
      }: {
        ref?: Ref<KeychainWindowContentRef>;
        onSelectInstance?: (instanceId: string) => void;
      }) => {
        if (ref && typeof ref !== 'function') {
          ref.current = { refresh: mockRefresh };
        }
        return (
          <div data-testid="keychain-content">
            Keychain Content
            <button
              type="button"
              onClick={() => onSelectInstance?.('instance-1')}
              data-testid="open-detail"
            >
              Open Detail
            </button>
          </div>
        );
      }
    )
}));

vi.mock('./KeychainWindowDetail', () => ({
  KeychainWindowDetail: ({
    instanceId,
    onBack,
    onDeleted
  }: {
    instanceId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="keychain-detail">
      <span data-testid="detail-instance">{instanceId}</span>
      <button type="button" onClick={onBack} data-testid="detail-back">
        Back
      </button>
      <button type="button" onClick={onDeleted} data-testid="detail-deleted">
        Deleted
      </button>
    </div>
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

  it('shows detail view when a keychain instance is selected', async () => {
    const user = userEvent.setup();
    render(<KeychainWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-detail'));
    expect(screen.getByTestId('keychain-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-instance')).toHaveTextContent(
      'instance-1'
    );
  });

  it('returns to list after closing detail view', async () => {
    const user = userEvent.setup();
    render(<KeychainWindow {...defaultProps} />);

    await user.click(screen.getByTestId('open-detail'));
    expect(screen.getByTestId('keychain-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('detail-back'));
    expect(screen.getByTestId('keychain-content')).toBeInTheDocument();
  });
});
