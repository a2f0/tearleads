import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileIcon } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopTaskbarWindow } from './DesktopTaskbar';
import { DesktopTaskbar } from './DesktopTaskbar';

const mockGetIcon = (type: string) => (
  <FileIcon className="h-3 w-3" data-testid={`icon-${type}`} />
);

const mockGetLabel = (type: string, title?: string) => title ?? type;

describe('DesktopTaskbar', () => {
  const mockWindows: DesktopTaskbarWindow[] = [
    { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: false },
    { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
  ];

  const defaultProps = {
    windows: mockWindows,
    getIcon: mockGetIcon,
    getLabel: mockGetLabel,
    footerHeight: 48,
    onFocusWindow: vi.fn(),
    onCloseWindow: vi.fn(),
    onMinimizeWindow: vi.fn(),
    onRestoreWindow: vi.fn(),
    onUpdateWindowDimensions: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an empty taskbar when no windows are open', () => {
    render(<DesktopTaskbar {...defaultProps} windows={[]} />);
    expect(screen.getByTestId('taskbar')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/taskbar-button/)).toHaveLength(0);
  });

  it('renders taskbar when windows are open', () => {
    render(<DesktopTaskbar {...defaultProps} />);
    expect(screen.getByTestId('taskbar')).toBeInTheDocument();
  });

  it('renders a button for each window', () => {
    render(<DesktopTaskbar {...defaultProps} />);
    const buttons = screen.getAllByTestId(/taskbar-button/);
    expect(buttons).toHaveLength(2);
  });

  it('highlights the topmost window as active', () => {
    render(<DesktopTaskbar {...defaultProps} />);
    const buttons = screen.getAllByTestId(/taskbar-button/);

    // The second window has higher zIndex, so it should be active
    expect(buttons[1]).toHaveClass('bg-primary/10');
    expect(buttons[0]).not.toHaveClass('bg-primary/10');
  });

  it('calls onFocusWindow when inactive window button is clicked', async () => {
    const onFocusWindow = vi.fn();
    const user = userEvent.setup();

    render(<DesktopTaskbar {...defaultProps} onFocusWindow={onFocusWindow} />);

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) await user.click(firstButton);

    expect(onFocusWindow).toHaveBeenCalledWith('notes-1');
  });

  it('calls onMinimizeWindow when active window button is clicked', async () => {
    const onMinimizeWindow = vi.fn();
    const user = userEvent.setup();

    render(
      <DesktopTaskbar {...defaultProps} onMinimizeWindow={onMinimizeWindow} />
    );

    // notes-2 is active (highest zIndex)
    const secondButton = screen.getAllByTestId(/taskbar-button/)[1];
    if (secondButton) await user.click(secondButton);

    expect(onMinimizeWindow).toHaveBeenCalledWith('notes-2', undefined);
  });

  it('calls onRestoreWindow when minimized window button is clicked', async () => {
    const onRestoreWindow = vi.fn();
    const user = userEvent.setup();

    const windowsWithMinimized: DesktopTaskbarWindow[] = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true },
      { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
    ];

    render(
      <DesktopTaskbar
        {...defaultProps}
        windows={windowsWithMinimized}
        onRestoreWindow={onRestoreWindow}
      />
    );

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) await user.click(firstButton);

    expect(onRestoreWindow).toHaveBeenCalledWith('notes-1');
  });

  it('shows minimized windows with reduced opacity', () => {
    const windowsWithMinimized: DesktopTaskbarWindow[] = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true },
      { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
    ];

    render(<DesktopTaskbar {...defaultProps} windows={windowsWithMinimized} />);

    const buttons = screen.getAllByTestId(/taskbar-button/);
    expect(buttons[0]).toHaveClass('opacity-60');
    expect(buttons[1]).not.toHaveClass('opacity-60');
  });

  it('applies custom className', () => {
    render(<DesktopTaskbar {...defaultProps} className="custom-class" />);
    expect(screen.getByTestId('taskbar')).toHaveClass('custom-class');
  });

  it('calls onContextMenu when right-clicking the taskbar', () => {
    const onContextMenu = vi.fn();
    render(<DesktopTaskbar {...defaultProps} onContextMenu={onContextMenu} />);

    fireEvent.contextMenu(screen.getByTestId('taskbar'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not bubble taskbar button context menu to taskbar', () => {
    const onContextMenu = vi.fn();
    render(<DesktopTaskbar {...defaultProps} onContextMenu={onContextMenu} />);

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) {
      fireEvent.contextMenu(firstButton);
    }

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('maximizes a minimized window from the context menu', async () => {
    const onUpdateWindowDimensions = vi.fn();
    const onRestoreWindow = vi.fn();
    const user = userEvent.setup();

    const windowsWithMinimized: DesktopTaskbarWindow[] = [
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        isMinimized: true,
        dimensions: { width: 400, height: 300, x: 10, y: 20 }
      },
      { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
    ];

    render(
      <DesktopTaskbar
        {...defaultProps}
        windows={windowsWithMinimized}
        onUpdateWindowDimensions={onUpdateWindowDimensions}
        onRestoreWindow={onRestoreWindow}
      />
    );

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) {
      fireEvent.contextMenu(firstButton);
    }

    await user.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(onUpdateWindowDimensions).toHaveBeenCalledWith(
      'notes-1',
      expect.objectContaining({
        x: 0,
        y: 0,
        isMaximized: true,
        preMaximizeDimensions: { width: 400, height: 300, x: 10, y: 20 }
      })
    );
    expect(onRestoreWindow).toHaveBeenCalledWith('notes-1');
  });

  it('minimizes the active window from the context menu', async () => {
    const onMinimizeWindow = vi.fn();
    const user = userEvent.setup();

    render(
      <DesktopTaskbar {...defaultProps} onMinimizeWindow={onMinimizeWindow} />
    );

    const secondButton = screen.getAllByTestId(/taskbar-button/)[1];
    if (secondButton) {
      fireEvent.contextMenu(secondButton);
    }

    await user.click(screen.getByRole('button', { name: 'Minimize' }));

    expect(onMinimizeWindow).toHaveBeenCalledWith('notes-2', undefined);
  });

  it('uses title from window when available', () => {
    const windowsWithTitle: DesktopTaskbarWindow[] = [
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        isMinimized: false,
        title: 'My Custom Title'
      }
    ];

    render(<DesktopTaskbar {...defaultProps} windows={windowsWithTitle} />);

    expect(screen.getByText('My Custom Title')).toBeInTheDocument();
  });

  it('preserves existing preMaximizeDimensions when maximizing', async () => {
    const onUpdateWindowDimensions = vi.fn();
    const onRestoreWindow = vi.fn();
    const user = userEvent.setup();

    const windowsWithPreMax: DesktopTaskbarWindow[] = [
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        isMinimized: true,
        dimensions: {
          width: 600,
          height: 400,
          x: 50,
          y: 50,
          isMaximized: true,
          preMaximizeDimensions: { width: 300, height: 200, x: 10, y: 10 }
        }
      }
    ];

    render(
      <DesktopTaskbar
        {...defaultProps}
        windows={windowsWithPreMax}
        onUpdateWindowDimensions={onUpdateWindowDimensions}
        onRestoreWindow={onRestoreWindow}
      />
    );

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) {
      fireEvent.contextMenu(firstButton);
    }

    await user.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(onUpdateWindowDimensions).toHaveBeenCalledWith(
      'notes-1',
      expect.objectContaining({
        isMaximized: true,
        preMaximizeDimensions: { width: 300, height: 200, x: 10, y: 10 }
      })
    );
  });

  it('maximizes window without dimensions', async () => {
    const onUpdateWindowDimensions = vi.fn();
    const onRestoreWindow = vi.fn();
    const user = userEvent.setup();

    const windowsWithoutDimensions: DesktopTaskbarWindow[] = [
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        isMinimized: true
      }
    ];

    render(
      <DesktopTaskbar
        {...defaultProps}
        windows={windowsWithoutDimensions}
        onUpdateWindowDimensions={onUpdateWindowDimensions}
        onRestoreWindow={onRestoreWindow}
      />
    );

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) {
      fireEvent.contextMenu(firstButton);
    }

    await user.click(screen.getByRole('button', { name: 'Maximize' }));

    expect(onUpdateWindowDimensions).toHaveBeenCalledWith(
      'notes-1',
      expect.objectContaining({
        x: 0,
        y: 0,
        isMaximized: true
      })
    );
    const callArg = onUpdateWindowDimensions.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty('preMaximizeDimensions');
  });
});
