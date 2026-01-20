import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskbarButton } from './TaskbarButton';

type TaskbarButtonProps = Parameters<typeof TaskbarButton>[0];

const buildProps = (
  overrides: Partial<TaskbarButtonProps> = {}
): TaskbarButtonProps => ({
  type: 'notes',
  isActive: false,
  onClick: vi.fn(),
  onMinimize: vi.fn(),
  onClose: vi.fn(),
  onMaximize: vi.fn(),
  ...overrides
});

const renderTaskbarButton = (overrides: Partial<TaskbarButtonProps> = {}) =>
  render(<TaskbarButton {...buildProps(overrides)} />);

describe('TaskbarButton', () => {
  it('renders with correct label for notes type', () => {
    renderTaskbarButton();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('shows active styling when isActive is true', () => {
    renderTaskbarButton({ isActive: true });
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-primary/10');
    expect(button).toHaveClass('border-primary/50');
  });

  it('shows inactive styling when isActive is false', () => {
    renderTaskbarButton();
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('bg-muted/50');
    expect(button).not.toHaveClass('bg-primary/10');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderTaskbarButton({ onClick });

    await user.click(screen.getByTestId('taskbar-button-notes'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders icon for notes type', () => {
    renderTaskbarButton();
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('renders with correct label for console type', () => {
    renderTaskbarButton({ type: 'console' });
    expect(screen.getByText('Console')).toBeInTheDocument();
  });

  it('renders icon for console type', () => {
    renderTaskbarButton({ type: 'console' });
    const button = screen.getByTestId('taskbar-button-console');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('shows minimized styling when isMinimized is true', () => {
    renderTaskbarButton({ isMinimized: true });
    const button = screen.getByTestId('taskbar-button-notes');
    expect(button).toHaveClass('opacity-60');
    expect(button).toHaveAttribute('data-minimized', 'true');
  });

  describe('when minimized', () => {
    it('shows correct context menu items', () => {
      renderTaskbarButton({ isMinimized: true });

      const button = screen.getByTestId('taskbar-button-notes');
      fireEvent.contextMenu(button);

      expect(
        screen.getByRole('button', { name: 'Restore' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Maximize' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('handles restore action', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderTaskbarButton({ isMinimized: true, onClick });

      const button = screen.getByTestId('taskbar-button-notes');
      fireEvent.contextMenu(button);
      await user.click(screen.getByRole('button', { name: 'Restore' }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('handles maximize action', async () => {
      const user = userEvent.setup();
      const onMaximize = vi.fn();
      renderTaskbarButton({ isMinimized: true, onMaximize });

      const button = screen.getByTestId('taskbar-button-notes');
      fireEvent.contextMenu(button);
      await user.click(screen.getByRole('button', { name: 'Maximize' }));

      expect(onMaximize).toHaveBeenCalledTimes(1);
    });

    it('handles close action', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderTaskbarButton({ isMinimized: true, onClose });

      const button = screen.getByTestId('taskbar-button-notes');
      fireEvent.contextMenu(button);
      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('renders with correct label for settings type', () => {
    renderTaskbarButton({ type: 'settings' });
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders icon for settings type', () => {
    renderTaskbarButton({ type: 'settings' });
    const button = screen.getByTestId('taskbar-button-settings');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('shows minimize and close context menu when active', () => {
    const onMinimize = vi.fn();
    const onClose = vi.fn();
    renderTaskbarButton({ isActive: true, onMinimize, onClose });

    const button = screen.getByTestId('taskbar-button-notes');
    fireEvent.contextMenu(button);

    expect(
      screen.getByRole('button', { name: 'Minimize' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
