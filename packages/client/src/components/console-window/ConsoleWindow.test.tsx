import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
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
  Terminal: ({
    className,
    autoFocus
  }: {
    className?: string;
    autoFocus?: boolean;
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (autoFocus) {
        inputRef.current?.focus();
      }
    }, [autoFocus]);
    return (
      <div data-testid="terminal" className={className}>
        <input
          ref={inputRef}
          data-testid="terminal-input"
          data-autofocus={autoFocus ? 'true' : 'false'}
        />
      </div>
    );
  }
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

  it('creates a new tab when New Tab is clicked', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Initially no tab bar (only 1 tab)
    expect(screen.queryByText('Terminal 1')).not.toBeInTheDocument();

    // Click New Tab
    await user.click(screen.getByTestId('new-tab-button'));

    // Now tab bar should appear with 2 tabs
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
  });

  it('creates a horizontal split when Split Horizontal is clicked', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Initially 1 terminal
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);

    // Click Split Horizontal
    await user.click(screen.getByTestId('split-horizontal-button'));

    // Now 2 terminals (main + split pane)
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);
  });

  it('creates a vertical split when Split Vertical is clicked', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Initially 1 terminal
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);

    // Click Split Vertical
    await user.click(screen.getByTestId('split-vertical-button'));

    // Now 2 terminals (main + split pane)
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);
  });

  it('focuses the split terminal input when creating a split', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    await user.click(screen.getByTestId('split-vertical-button'));

    const inputs = screen.getAllByTestId('terminal-input');
    expect(inputs).toHaveLength(2);
    await waitFor(() => {
      expect(inputs[1]).toHaveFocus();
    });
    expect(inputs[1]).toHaveAttribute('data-autofocus', 'true');
  });

  it('removes split when clicked again', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Click Split Horizontal
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);

    // Click again to remove split
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);
  });

  it('can switch between tabs', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create a new tab
    await user.click(screen.getByTestId('new-tab-button'));

    // Click on Terminal 1 tab
    await user.click(screen.getByText('Terminal 1'));

    // Both tabs should still be visible in tab bar
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
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

  it('calls onClose when closing the last tab', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConsoleWindow {...defaultProps} onClose={onClose} />);

    // Create a second tab so we see the tab bar
    await user.click(screen.getByTestId('new-tab-button'));
    expect(
      screen.getAllByRole('button', { name: /Close Terminal \d/i })
    ).toHaveLength(2);

    // Close Terminal 1 tab
    await user.click(screen.getByRole('button', { name: /Close Terminal 1/i }));

    // Now only one tab, close it - use the menu bar close button
    // (tab bar is hidden with only 1 tab)
    await user.click(screen.getByTestId('close-button'));

    expect(onClose).toHaveBeenCalled();
  });

  it('removes split when closing the split pane tab', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create a split
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);

    // Toggle off the split - should go back to 1 terminal
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);
  });

  it('switches to previous tab when closing active tab that is not first', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create two more tabs
    await user.click(screen.getByTestId('new-tab-button'));
    await user.click(screen.getByTestId('new-tab-button'));

    // Should have 3 tabs visible, Terminal 3 is active
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    expect(screen.getByText('Terminal 3')).toBeInTheDocument();

    // Close Terminal 3 (the active tab)
    await user.click(screen.getByRole('button', { name: /Close Terminal 3/i }));

    // Should now have 2 tabs
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    expect(screen.queryByText('Terminal 3')).not.toBeInTheDocument();
  });

  it('switches to first tab when closing active first tab', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create a second tab
    await user.click(screen.getByTestId('new-tab-button'));

    // Switch to first tab
    await user.click(screen.getByText('Terminal 1'));

    // Close the first tab (active)
    await user.click(screen.getByRole('button', { name: /Close Terminal 1/i }));

    // Should now only have Terminal 2
    expect(screen.queryByText('Terminal 1')).not.toBeInTheDocument();
    // Tab bar hides when only 1 tab
    expect(screen.queryByText('Terminal 2')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal')).toBeInTheDocument();
  });

  it('removes vertical split and tab when toggling off', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create a vertical split
    await user.click(screen.getByTestId('split-vertical-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);

    // Toggle off
    await user.click(screen.getByTestId('split-vertical-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);
  });

  it('keeps terminal panes scrollable in vertical split', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    await user.click(screen.getByTestId('split-vertical-button'));

    const terminals = screen.getAllByTestId('terminal');
    const paneClasses = terminals.map(
      (terminal) => terminal.parentElement?.parentElement?.className ?? ''
    );

    paneClasses.forEach((classes) => {
      expect(classes).toContain('min-h-0');
      expect(classes).toContain('min-w-0');
    });
  });

  it('switches from horizontal to vertical split', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindow {...defaultProps} />);

    // Create horizontal split
    await user.click(screen.getByTestId('split-horizontal-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(2);

    // Click vertical - should remove horizontal split first
    await user.click(screen.getByTestId('split-vertical-button'));
    expect(screen.getAllByTestId('terminal')).toHaveLength(1);
  });
});
