import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Taskbar } from './Taskbar';

const mockWindows: Array<{
  id: string;
  type: 'notes';
  zIndex: number;
  isMinimized: boolean;
}> = [
  { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: false },
  { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
];

const mockFocusWindow = vi.fn();
const mockMinimizeWindow = vi.fn();
const mockRestoreWindow = vi.fn();

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    windows: mockWindows,
    focusWindow: mockFocusWindow,
    minimizeWindow: mockMinimizeWindow,
    restoreWindow: mockRestoreWindow
  })
}));

describe('Taskbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindows.length = 0;
    mockWindows.push(
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: false },
      { id: 'notes-2', type: 'notes', zIndex: 101, isMinimized: false }
    );
  });

  it('renders nothing when no windows are open', () => {
    mockWindows.length = 0;
    const { container } = render(<Taskbar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders taskbar when windows are open', () => {
    render(<Taskbar />);
    expect(screen.getByTestId('taskbar')).toBeInTheDocument();
  });

  it('renders a button for each window', () => {
    render(<Taskbar />);
    const buttons = screen.getAllByTestId(/taskbar-button/);
    expect(buttons).toHaveLength(2);
  });

  it('highlights the topmost window as active', () => {
    render(<Taskbar />);
    const buttons = screen.getAllByTestId(/taskbar-button/);

    // The second window has higher zIndex, so it should be active
    expect(buttons[1]).toHaveClass('bg-primary/10');
    expect(buttons[0]).not.toHaveClass('bg-primary/10');
  });

  it('calls focusWindow when inactive window button is clicked', async () => {
    const user = userEvent.setup();
    render(<Taskbar />);

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) await user.click(firstButton);

    expect(mockFocusWindow).toHaveBeenCalledWith('notes-1');
  });

  it('calls minimizeWindow when active window button is clicked', async () => {
    const user = userEvent.setup();
    render(<Taskbar />);

    // notes-2 is active (highest zIndex)
    const secondButton = screen.getAllByTestId(/taskbar-button/)[1];
    if (secondButton) await user.click(secondButton);

    expect(mockMinimizeWindow).toHaveBeenCalledWith('notes-2');
  });

  it('calls restoreWindow when minimized window button is clicked', async () => {
    const firstWindow = mockWindows[0];
    if (firstWindow) firstWindow.isMinimized = true;
    const user = userEvent.setup();
    render(<Taskbar />);

    const firstButton = screen.getAllByTestId(/taskbar-button/)[0];
    if (firstButton) await user.click(firstButton);

    expect(mockRestoreWindow).toHaveBeenCalledWith('notes-1');
  });

  it('shows minimized windows with reduced opacity', () => {
    const firstWindow = mockWindows[0];
    if (firstWindow) firstWindow.isMinimized = true;
    render(<Taskbar />);

    const buttons = screen.getAllByTestId(/taskbar-button/);
    expect(buttons[0]).toHaveClass('opacity-60');
    expect(buttons[1]).not.toHaveClass('opacity-60');
  });

  it('applies custom className', () => {
    render(<Taskbar className="custom-class" />);
    expect(screen.getByTestId('taskbar')).toHaveClass('custom-class');
  });
});
