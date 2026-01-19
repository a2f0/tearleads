import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPreserveWindowState } from '@/lib/windowStatePreference';
import { ChatWindowMenuBar } from './ChatWindowMenuBar';

describe('ChatWindowMenuBar', () => {
  const defaultProps = {
    onNewChat: vi.fn(),
    onClose: vi.fn()
  };

  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
  });

  it('renders File menu trigger', () => {
    render(<ChatWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows New Chat and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<ChatWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Chat' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<ChatWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Preserve Window State in View menu', async () => {
    const user = userEvent.setup();
    render(<ChatWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Preserve Window State' })
    ).toBeInTheDocument();
  });

  it('calls onNewChat when New Chat is clicked', async () => {
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    render(<ChatWindowMenuBar {...defaultProps} onNewChat={onNewChat} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Chat' }));

    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChatWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
