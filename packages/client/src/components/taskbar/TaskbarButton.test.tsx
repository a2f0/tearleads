import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskbarButton } from './TaskbarButton';

describe('TaskbarButton', () => {
  it('renders with correct label for notes type', () => {
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('shows active styling when isActive is true', () => {
    render(
      <TaskbarButton
        type="notes"
        isActive={true}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-primary/10');
    expect(button).toHaveClass('border-primary/50');
  });

  it('shows inactive styling when isActive is false', () => {
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-muted/50');
    expect(button).not.toHaveClass('bg-primary/10');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        onClick={onClick}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('taskbar-button-notes'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders icon for notes type', () => {
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with correct label for console type', () => {
    render(
      <TaskbarButton
        type="console"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    expect(screen.getByText('Console')).toBeInTheDocument();
  });

  it('renders icon for console type', () => {
    render(
      <TaskbarButton
        type="console"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-console');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('shows minimized styling when isMinimized is true', () => {
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        isMinimized={true}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('opacity-60');
    expect(button).toHaveAttribute('data-minimized', 'true');
  });

  it('shows restore context menu when minimized', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onMaximize = vi.fn();
    render(
      <TaskbarButton
        type="notes"
        isActive={false}
        isMinimized={true}
        onClick={onClick}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={onMaximize}
      />
    );

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    const restoreItem = screen.getByRole('button', { name: 'Restore' });
    const maximizeItem = screen.getByRole('button', { name: 'Maximize' });
    expect(restoreItem).toBeInTheDocument();
    expect(maximizeItem).toBeInTheDocument();

    await user.click(restoreItem);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(button);
    await user.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it('renders with correct label for settings type', () => {
    render(
      <TaskbarButton
        type="settings"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders icon for settings type', () => {
    render(
      <TaskbarButton
        type="settings"
        isActive={false}
        onClick={vi.fn()}
        onMinimize={vi.fn()}
        onClose={vi.fn()}
        onMaximize={vi.fn()}
      />
    );
    const button = screen.getByTestId('taskbar-button-settings');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('shows minimize and close context menu when active', () => {
    const onMinimize = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskbarButton
        type="notes"
        isActive={true}
        onClick={vi.fn()}
        onMinimize={onMinimize}
        onClose={onClose}
        onMaximize={vi.fn()}
      />
    );

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    expect(
      screen.getByRole('button', { name: 'Minimize' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
