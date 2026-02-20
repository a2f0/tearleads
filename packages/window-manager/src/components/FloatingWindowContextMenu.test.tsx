import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingWindow } from './FloatingWindow.js';

const FOOTER_HEIGHT = 56;

describe('FloatingWindow title bar context menu', () => {
  const defaultProps = {
    id: 'test-window',
    title: 'Test Window',
    onClose: vi.fn(),
    children: <div data-testid="window-content">Content</div>,
    footerHeight: FOOTER_HEIGHT
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768
    });
  });

  it('opens rename menu on title bar context menu', () => {
    render(<FloatingWindow {...defaultProps} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 180 });

    expect(
      screen.getByTestId('floating-window-test-window-title-bar-context-menu')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('floating-window-test-window-rename-title-menu-item')
    ).toBeInTheDocument();
  });

  it('renames window title from title bar context menu', async () => {
    const user = userEvent.setup();
    render(<FloatingWindow {...defaultProps} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 180 });
    await user.click(
      screen.getByTestId('floating-window-test-window-rename-title-menu-item')
    );
    const titleInput = screen.getByTestId(
      'floating-window-test-window-title-input'
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed{Enter}');
    expect(screen.getByText('Renamed')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Renamed');
  });

  it('does not rename when title edit is cancelled', async () => {
    const user = userEvent.setup();
    render(<FloatingWindow {...defaultProps} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 180 });
    await user.click(
      screen.getByTestId('floating-window-test-window-rename-title-menu-item')
    );
    const titleInput = screen.getByTestId(
      'floating-window-test-window-title-input'
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed{Escape}');
    expect(screen.getByText('Test Window')).toBeInTheDocument();
  });

  it('calls onRename with the new title when renamed', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<FloatingWindow {...defaultProps} onRename={onRename} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 180 });
    await user.click(
      screen.getByTestId('floating-window-test-window-rename-title-menu-item')
    );
    const titleInput = screen.getByTestId(
      'floating-window-test-window-title-input'
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'Custom Name{Enter}');

    expect(onRename).toHaveBeenCalledWith('Custom Name');
  });

  it('does not call onRename when title edit is cancelled', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<FloatingWindow {...defaultProps} onRename={onRename} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.contextMenu(titleBar, { clientX: 120, clientY: 180 });
    await user.click(
      screen.getByTestId('floating-window-test-window-rename-title-menu-item')
    );
    const titleInput = screen.getByTestId(
      'floating-window-test-window-title-input'
    );
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title{Escape}');

    expect(onRename).not.toHaveBeenCalled();
  });
});
