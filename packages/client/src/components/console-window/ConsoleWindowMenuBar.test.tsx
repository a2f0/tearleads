import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleWindowMenuBar } from './ConsoleWindowMenuBar';

describe('ConsoleWindowMenuBar', () => {
  const defaultProps = {
    onNewTab: vi.fn(),
    onClose: vi.fn(),
    onSplitHorizontal: vi.fn(),
    onSplitVertical: vi.fn()
  };

  it('renders File menu trigger', () => {
    render(<ConsoleWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<ConsoleWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows New Tab and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Tab' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onNewTab when New Tab is clicked', async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    render(<ConsoleWindowMenuBar {...defaultProps} onNewTab={onNewTab} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Tab' }));

    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConsoleWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Split Horizontal and Split Vertical options in View menu', async () => {
    const user = userEvent.setup();
    render(<ConsoleWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Split Horizontal' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Split Vertical' })
    ).toBeInTheDocument();
  });

  it('calls onSplitHorizontal when Split Horizontal is clicked', async () => {
    const user = userEvent.setup();
    const onSplitHorizontal = vi.fn();
    render(
      <ConsoleWindowMenuBar
        {...defaultProps}
        onSplitHorizontal={onSplitHorizontal}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Split Horizontal' })
    );

    expect(onSplitHorizontal).toHaveBeenCalledTimes(1);
  });

  it('calls onSplitVertical when Split Vertical is clicked', async () => {
    const user = userEvent.setup();
    const onSplitVertical = vi.fn();
    render(
      <ConsoleWindowMenuBar
        {...defaultProps}
        onSplitVertical={onSplitVertical}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Split Vertical' }));

    expect(onSplitVertical).toHaveBeenCalledTimes(1);
  });
});
