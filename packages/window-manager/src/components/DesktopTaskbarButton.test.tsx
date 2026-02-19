import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileIcon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopTaskbarButton } from './DesktopTaskbarButton';

describe('DesktopTaskbarButton', () => {
  const defaultProps = {
    windowId: 'window-1',
    type: 'notes',
    icon: <FileIcon className="h-3 w-3" data-testid="icon" />,
    label: 'Notes',
    isActive: false,
    isMinimized: false,
    onClick: vi.fn(),
    onMinimize: vi.fn(),
    onClose: vi.fn(),
    onMaximize: vi.fn()
  };

  it('renders the button with icon and label', () => {
    render(<DesktopTaskbarButton {...defaultProps} />);

    expect(screen.getByTestId('taskbar-button-notes')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('applies active styles when isActive is true', () => {
    render(<DesktopTaskbarButton {...defaultProps} isActive={true} />);

    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-primary/10');
    expect(button).toHaveClass('border-primary/50');
  });

  it('applies inactive styles when isActive is false', () => {
    render(<DesktopTaskbarButton {...defaultProps} isActive={false} />);

    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-muted/50');
    expect(button).toHaveClass('border-border');
  });

  it('applies minimized opacity when isMinimized is true', () => {
    render(<DesktopTaskbarButton {...defaultProps} isMinimized={true} />);

    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('opacity-60');
    expect(button).toHaveAttribute('data-minimized', 'true');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<DesktopTaskbarButton {...defaultProps} onClick={onClick} />);

    await user.click(screen.getByTestId('taskbar-button-notes'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows context menu on right-click', async () => {
    render(<DesktopTaskbarButton {...defaultProps} />);

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    // Context menu should show minimize option for non-minimized window
    expect(screen.getByText('Minimize')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('shows restore and maximize options for minimized window', async () => {
    render(<DesktopTaskbarButton {...defaultProps} isMinimized={true} />);

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    expect(screen.getByText('Restore')).toBeInTheDocument();
    expect(screen.getByText('Maximize')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('calls onMinimize when minimize context menu item is clicked', async () => {
    const onMinimize = vi.fn();
    const user = userEvent.setup();

    render(<DesktopTaskbarButton {...defaultProps} onMinimize={onMinimize} />);

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    await user.click(screen.getByText('Minimize'));

    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close context menu item is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<DesktopTaskbarButton {...defaultProps} onClose={onClose} />);

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    await user.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClick (restore) when restore context menu item is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <DesktopTaskbarButton
        {...defaultProps}
        isMinimized={true}
        onClick={onClick}
      />
    );

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    await user.click(screen.getByText('Restore'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onMaximize when maximize context menu item is clicked', async () => {
    const onMaximize = vi.fn();
    const user = userEvent.setup();

    render(
      <DesktopTaskbarButton
        {...defaultProps}
        isMinimized={true}
        onMaximize={onMaximize}
      />
    );

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    await user.click(screen.getByText('Maximize'));

    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(<DesktopTaskbarButton {...defaultProps} className="custom-class" />);

    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('custom-class');
  });

  it('has data-window-id attribute', () => {
    render(<DesktopTaskbarButton {...defaultProps} windowId="my-window" />);

    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveAttribute('data-window-id', 'my-window');
  });

  it('closes context menu when pressing Escape', async () => {
    const user = userEvent.setup();
    render(<DesktopTaskbarButton {...defaultProps} />);

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    // Context menu should be open
    expect(screen.getByText('Minimize')).toBeInTheDocument();

    // Press Escape to close
    await user.keyboard('{Escape}');

    // Context menu should be closed
    expect(screen.queryByText('Minimize')).not.toBeInTheDocument();
  });
});
