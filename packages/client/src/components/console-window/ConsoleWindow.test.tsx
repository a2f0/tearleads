import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleWindow } from './ConsoleWindow';

// Mock database hooks
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

// Mock FloatingWindow
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

// Mock Terminal component
vi.mock('@/pages/console/components/Terminal', () => ({
  Terminal: ({ className }: { className?: string }) => (
    <div data-testid="terminal" className={className}>
      Terminal Mock
    </div>
  )
}));

// Mock ConsoleWindowMenuBar
vi.mock('./ConsoleWindowMenuBar', () => ({
  ConsoleWindowMenuBar: ({
    onNewTab,
    onClose,
    onSplitHorizontal,
    onSplitVertical
  }: {
    onNewTab: () => void;
    onClose: () => void;
    onSplitHorizontal: () => void;
    onSplitVertical: () => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onNewTab} data-testid="new-tab-button">
        New Tab
      </button>
      <button type="button" onClick={onClose} data-testid="close-button">
        Close
      </button>
      <button
        type="button"
        onClick={onSplitHorizontal}
        data-testid="split-horizontal-button"
      >
        Split Horizontal
      </button>
      <button
        type="button"
        onClick={onSplitVertical}
        data-testid="split-vertical-button"
      >
        Split Vertical
      </button>
    </div>
  )
}));

describe('ConsoleWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<ConsoleWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Console as title', () => {
    render(<ConsoleWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Console');
  });

  it('renders the menu bar', () => {
    render(<ConsoleWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders the terminal', () => {
    render(<ConsoleWindow {...defaultProps} />);
    expect(screen.getByTestId('terminal')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConsoleWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu bar Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConsoleWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders terminal with correct styling', () => {
    render(<ConsoleWindow {...defaultProps} />);
    const terminal = screen.getByTestId('terminal');
    expect(terminal).toHaveClass('h-full');
    expect(terminal).toHaveClass('rounded-none');
    expect(terminal).toHaveClass('border-0');
  });

  it('handles New Tab click (no-op for now)', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Click should not throw
    await user.click(screen.getByTestId('new-tab-button'));
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('handles Split Horizontal click (no-op for now)', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Click should not throw
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('handles Split Vertical click (no-op for now)', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Click should not throw
    await user.click(screen.getByTestId('split-vertical-button'));
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('renders with initialDimensions when provided', () => {
    const initialDimensions = {
      width: 800,
      height: 600,
      x: 100,
      y: 100
    };
    render(
      <ConsoleWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });
});
